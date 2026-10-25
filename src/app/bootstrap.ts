import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { watch } from 'vue'
import { getLocale, logFrontend, setLocale } from '../api/tauri'
import { detectDefaultLocale, type SupportedLocale } from '../utils/locale'
import i18n from '../i18n'
import { useTheme } from '../composables/useTheme'
import { registerBuiltinPlugins } from '../plugins/registerBuiltins'
import { loadExternalPlugins } from '../plugins/loadExternalPlugins'
import { ensurePluginLogConsole, installPluginConsoleForwarding } from '../plugins/pluginApi'
import { useEventHub } from '../stores/eventHub'
import { REST_ONLY_MIGRATION } from '../config/pluginScope'
import { pinia } from './legacy/vueRuntime'
import { useShellStore } from './store'
import { detectWindowMode } from './preflight'

/**
 * 应用启动流程（原 src/main.ts 的平移，React 版）：
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

async function initLocale(): Promise<void> {
  const stored = await getLocale().catch(() => null)
  const persisted = stored === 'en-US' || stored === 'zh-CN'
  const locale: SupportedLocale = persisted ? stored : detectDefaultLocale()
  i18n.global.locale.value = locale
  if (!persisted) {
    await setLocale(locale).catch(() => {})
  }
}

/** 迁移期：theme / locale 的真源在 Vue 单例，镜像到 zustand 供 React 渲染。 */
function mirrorVueStateIntoStore(): void {
  const { mode, resolved } = useTheme()
  const syncTheme = () => {
    useShellStore.getState().setThemeState(mode.value, resolved.value)
  }
  syncTheme()
  watch([mode, resolved], syncTheme)
  watch(
    () => i18n.global.locale.value,
    (value) => {
      useShellStore.getState().setLocale(value === 'en-US' ? 'en-US' : 'zh-CN')
    },
    { immediate: true },
  )
}

export async function bootstrap(): Promise<void> {
  const windowMode = detectWindowMode()
  installDevToolsShortcut()

  if (windowMode === 'plugin-host') {
    // 插件后台宿主窗：console 转发到宿主日志（带插件 id 前缀）。
    const pluginId = getCurrentWindow().label.replace(/^plugin-bg-/, '')
    installPluginConsoleForwarding(pluginId)
  } else {
    patchConsole()
    ensurePluginLogConsole(nativeConsole)
  }

  if (windowMode === 'main') {
    document.documentElement.classList.add('catrace-shell')
    // 先注册内置插件，插件页才能立刻解析到 SettingsComponent。
    registerBuiltinPlugins()
  }

  if (windowMode !== 'plugin-host') {
    if (REST_ONLY_MIGRATION) {
      console.info('[plugins] 迁移期收口：外部插件已全部停用，仅保留久坐提醒')
    } else {
      void loadExternalPlugins().catch((error) => {
        console.warn('[plugins] loadExternalPlugins failed', error)
      })
    }
  }

  await initLocale()
  await useTheme().init()
  mirrorVueStateIntoStore()

  if (windowMode === 'main') {
    void useEventHub(pinia)
      .startListening()
      .catch((error) => console.warn('[eventHub] startListening failed', error))
  }
}
