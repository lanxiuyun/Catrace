import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'

// 从 URL query 参数读取提醒类型（弹窗创建时传入）
const url = new URL(window.location.href)
const reminder = url.searchParams.get('reminder')
if (reminder === 'popup' || reminder === 'fullscreen') {
  (window as any).__CATRACE_REMINDER_TYPE__ = reminder
  window.location.hash = reminder === 'popup' ? '#/reminder-popup' : '#/reminder-fullscreen'
}

const app = createApp(App)
app.use(router)
app.use(i18n)
app.mount('#app')
