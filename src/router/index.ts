import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Plugins from '../views/Plugins.vue'
import Settings from '../views/Settings.vue'
import Debug from '../views/Debug.vue'
import ReminderPopup from '../views/ReminderPopup.vue'
import ReminderFullscreen from '../views/ReminderFullscreen.vue'
import ReminderToast from '../views/ReminderToast.vue'
import PluginHost from '../views/PluginHost.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: Dashboard },
    { path: '/plugins', component: Plugins },
    { path: '/settings', component: Settings },
    { path: '/debug', component: Debug },
    { path: '/reminder-popup', component: ReminderPopup },
    { path: '/reminder-fullscreen', component: ReminderFullscreen },
    { path: '/reminder-toast', component: ReminderToast },
    { path: '/plugin-host', component: PluginHost },
  ],
})

export default router
