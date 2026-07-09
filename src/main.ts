import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { logFrontend } from './api/tauri'

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
app.use(router)
app.use(i18n)
app.mount('#app')
