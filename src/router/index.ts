import { createRouter, createWebHashHistory } from 'vue-router'
import MainShell from '../views/mainWindow/MainShell.vue'
import ToastShell from '../views/toastWindows/ToastShell.vue'
import Dashboard from '../views/mainWindow/Dashboard.vue'
import Plugins from '../views/mainWindow/Plugins.vue'
import Settings from '../views/mainWindow/Settings.vue'
import Debug from '../views/mainWindow/Debug.vue'
import ReminderPopup from '../views/toastWindows/ReminderPopup.vue'
import ReminderFullscreen from '../views/toastWindows/ReminderFullscreen.vue'
import ReminderToast from '../views/toastWindows/ReminderToast.vue'
import PluginHost from '../views/toastWindows/PluginHost.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: MainShell,
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: Dashboard },
        { path: 'plugins', component: Plugins },
        { path: 'settings', component: Settings },
        { path: 'debug', component: Debug },
      ],
    },
    {
      path: '/',
      component: ToastShell,
      children: [
        { path: 'reminder-popup', component: ReminderPopup },
        { path: 'reminder-fullscreen', component: ReminderFullscreen },
        { path: 'reminder-toast', component: ReminderToast },
        { path: 'plugin-host', component: PluginHost },
      ],
    },
  ],
})

export default router
