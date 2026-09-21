import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/theme.css'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { getLocale, logFrontend, setLocale } from './api/tauri'
import { detectDefaultLocale, type SupportedLocale } from './utils/locale'
import { useEventHub } from './stores/eventHub'
import { registerBuiltinPlugins } from './plugins/registerBuiltins'
import { loadExternalPlugins } from './plugins/loadExternalPlugins'
import { ensurePluginLogConsole } from './plugins/pluginApi'
import { useTheme } from './composables/useTheme'

// 从 URL query 参数读取提醒类型（弹窗创建时传入）
const url = new URL(window.location.href)
const reminder = url.searchParams.get('reminder')
if (reminder === 'popup' || reminder === 'fullscreen') {
  (window as any).__CATRACE_REMINDER_TYPE__ = reminder
  window.location.hash = reminder === 'popup' ? '#/reminder-popup' : '#/reminder-fullscreen'
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
patchConsole()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)

// Main window only: observe Event Bus (do not drive Toast rendering).
const isPluginHost = window.location.hash.includes('plugin-host')
const isToastOrReminder =
  reminder === 'popup' ||
  reminder === 'fullscreen' ||
  window.location.hash.includes('reminder-toast') ||
  window.location.hash.includes('reminder-popup') ||
  window.location.hash.includes('reminder-fullscreen') ||
  isPluginHost
if (!isToastOrReminder) {
  // Register before mount so #/plugins can resolve SettingsComponent immediately.
  registerBuiltinPlugins()
  ensurePluginLogConsole()
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
