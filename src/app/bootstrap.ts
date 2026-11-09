import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { logFrontend } from '../api/tauri'
import { initTheme } from '../composables/useTheme'
import { initLocale } from './i18n'
import { registerBuiltinPlugins } from '../plugins/registerBuiltins'
import { loadExternalPlugins } from '../plugins/loadExternalPlugins'
import { ensurePluginLogConsole, installPluginConsoleForwarding } from '../plugins/pluginApi'
import { useEventHub } from '../stores/eventHub'
import { clearPluginHostCardCache } from '../components/pluginHostCardCache'
import { detectWindowMode } from './preflight'

/**
 * React 应用启动流程：
 * 窗口分流 → console 埋点 → 插件注册 → 语言/主题初始化 → Event Bus 订阅。
 * 渲染由 main.tsx 在本函数完成后触发，避免主题/语言闪一下再变（FOUC）。
 */

const nativeConsole = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

/** 前端 console 输出同时写入后端日志文件（不影响控制台输出）。 */
function patchConsole(): void {
  const levels: Array<'log' | 'warn' | 'error'> = ['log', 'warn', 'error']
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try {
        const message = args
          .map((value) => {
            try {
              if (typeof value === 'object') return JSON.stringify(value)
              return String(value)
            } catch {
              return '[unstringifiable]'
            }
          })
          .join(' ')
        const mappedLevel = level === 'log' ? 'info' : level
        void logFrontend(mappedLevel, message).catch(() => {})
      } catch {
        /* 日志发送失败不影响业务 */
      }
    }
  }
}

/** 全窗口共用：F12 切换当前聚焦窗口的 DevTools。 */
function installDevToolsShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'F12') {
      event.preventDefault()
      void invoke('toggle_devtools').catch(() => {})
    }
  })
}

export async function bootstrap(): Promise<void> {
  const windowMode = detectWindowMode()
  installDevToolsShortcut()

  if (windowMode === 'plugin-host') {
    // 插件后台宿主窗：console 转发到宿主日志（带插件 id 前缀）。
    const pluginId = getCurrentWindow().label.replace(/^plugin-bg-/, '')
    installPluginConsoleForwarding(pluginId)
    // Background plugins use scoped plugin APIs, not the host's settings store.
    // The plugin-host page initializes its scoped runtime; it does not read host settings.
    return
  } else {
    patchConsole()
    ensurePluginLogConsole(nativeConsole)
  }

  if (windowMode === 'main') {
    document.documentElement.classList.add('catrace-shell')
    // 先注册内置插件，插件页才能立刻解析到 SettingsComponent。
    registerBuiltinPlugins()
  }

  // Backend events follow persistence; only refresh frontend modules here.
  const reload = () => {
    void loadExternalPlugins({ force: true })
      .then(() => clearPluginHostCardCache())
      .catch((error) => console.warn('[plugins] reload failed', error))
  }
  await Promise.all(
    ['plugins-reloaded', 'plugin-enabled-changed'].map((eventName) =>
      listen(eventName, reload).catch((error) => {
        console.warn(`[plugins] listen ${eventName} failed`, error)
      }),
    ),
  )
  void loadExternalPlugins().catch((error) => {
    console.warn('[plugins] loadExternalPlugins failed', error)
  })

  await initLocale()
  await initTheme()

  if (windowMode === 'main') {
    void useEventHub.getState()
      .startListening()
      .catch((error) => console.warn('[eventHub] startListening failed', error))
  }
}
