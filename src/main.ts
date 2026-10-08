import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './styles/theme.css'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { getLocale, logFrontend, setLocale } from './api/tauri'
import { detectDefaultLocale, type SupportedLocale } from './utils/locale'
import { useEventHub } from './stores/eventHub'
import { registerBuiltinPlugins } from './plugins/registerBuiltins'
import { loadExternalPlugins } from './plugins/loadExternalPlugins'
import { ensurePluginLogConsole, installPluginConsoleForwarding } from './plugins/pluginApi'
import { useTheme } from './composables/useTheme'

// 从 URL query 参数读取提醒类型（弹窗创建时传入）
const url = new URL(window.location.href)
const reminder = url.searchParams.get('reminder')
if (reminder === 'popup' || reminder === 'fullscreen') {
  (window as any).__CATRACE_REMINDER_TYPE__ = reminder
  window.location.hash = reminder === 'popup' ? '#/reminder-popup' : '#/reminder-fullscreen'
}

// 全窗口共享：F12 切换当前聚焦窗口的 DevTools（主窗 / Toast / 弹窗 / 全屏 / 插件后台窗共用入口）。
// Toast 窗平时 WS_EX_NOACTIVATE 不持焦点，点击卡片（active_mode→focus）后即可接收按键。
window.addEventListener('keydown', (e) => {
  if (e.key === 'F12') {
    e.preventDefault()
    void invoke('toggle_devtools').catch(() => {})
  }
})

// 原生 console 快照：下面 patchConsole / 插件日志转发会覆盖 console.*，
// 插件日志镜像（catrace:plugin-log）必须走原生方法打印——否则镜像行会被
// 本窗口的 patchConsole 再转发回宿主日志，造成双落盘
const nativeConsole: Pick<Console, 'info' | 'warn' | 'error'> = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

// 捕获前端 console 输出，同时写入后端统一日志文件（不影响控制台输出）
function patchConsole() {
  const levels: Array<'log' | 'warn' | 'error'> = ['log', 'warn', 'error']
  for (const level of levels) {
    const original = (console as any)[level]
    ;(console as any)[level] = (...args: any[]) => {
      original.apply(console, args)
      try {
        const message = args
          .map((a) => {
            try {
              if (typeof a === 'object') return JSON.stringify(a)
              return String(a)
            } catch {
              return '[unstringifiable]'
            }
          })
          .join(' ')
        const mappedLevel = level === 'log' ? 'info' : level
        logFrontend(mappedLevel, message).catch(() => {})
      } catch {
        // 日志发送失败不应影响业务
      }
    }
  }
}

// 插件后台宿主窗（plugin-bg-*）与普通窗口在此分流：
// - 普通窗：console → log_frontend（宿主日志，打 frontend 标签）
// - 插件宿主：console → plugin_api_log（带插件 id 前缀进宿主日志，并镜像到主窗 DevTools）
const isPluginHost = window.location.hash.includes('plugin-host')
if (isPluginHost) {
  const pluginId = getCurrentWindow().label.replace(/^plugin-bg-/, '')
  installPluginConsoleForwarding(pluginId)
} else {
  patchConsole()
}

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)

// Main window only: observe Event Bus (do not drive Toast rendering).
const isToastOrReminder =
  reminder === 'popup' ||
  reminder === 'fullscreen' ||
  window.location.hash.includes('reminder-toast') ||
  window.location.hash.includes('reminder-popup') ||
  window.location.hash.includes('reminder-fullscreen') ||
  isPluginHost
if (!isToastOrReminder) {
  document.documentElement.classList.add('catrace-shell')
  // Register before mount so #/plugins can resolve SettingsComponent immediately.
  registerBuiltinPlugins()
  ensurePluginLogConsole(nativeConsole)
}

// Toast / 弹窗窗：同样镜像插件日志到本窗口 DevTools（sidecar log op 与后台
// WebView 转发都经宿主 catrace:plugin-log 事件到达），F12 排插件问题不用切回主窗
if (isToastOrReminder && !isPluginHost) {
  ensurePluginLogConsole(nativeConsole)
}

// External plugins: Card map must exist in toast window; Settings list in main.
// A background host loads only its own background source.
if (!isPluginHost) {
  void loadExternalPlugins().catch((e) => {
    console.warn('[plugins] loadExternalPlugins failed', e)
  })
}

async function applyHostLocale(loc: string | null | undefined) {
  const persisted = loc === 'en-US' || loc === 'zh-CN'
  const locale: SupportedLocale = persisted ? loc : detectDefaultLocale()
  i18n.global.locale.value = locale
  if (!persisted) {
    await setLocale(locale).catch(() => {})
  }
}

const localeReady = getLocale()
  .then(applyHostLocale)
  .catch(() => applyHostLocale(null))

// 挂载前初始化主题（读持久化偏好 + 落地 data-theme），避免亮色闪白(FOUC)
useTheme().init().finally(() => {
  void localeReady.finally(() => {
    app.mount('#app')
  })
})

if (!isToastOrReminder) {
  useEventHub(pinia).startListening().catch((e) => {
    console.warn('[eventHub] startListening failed', e)
  })
}
