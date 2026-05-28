import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'

console.log('[main.ts] starting, hash=', window.location.hash, 'reminderType=', (window as any).__CATRACE_REMINDER_TYPE__)

const app = createApp(App)
app.use(router)
app.use(i18n)
app.mount('#app')

console.log('[main.ts] mounted')
