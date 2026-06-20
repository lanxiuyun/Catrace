import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Settings from '../views/Settings.vue'
import VideoRules from '../views/VideoRules.vue'
import Debug from '../views/Debug.vue'
import ReminderPopup from '../views/ReminderPopup.vue'
import ReminderFullscreen from '../views/ReminderFullscreen.vue'
import ReminderToast from '../views/ReminderToast.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: Dashboard },
    { path: '/settings', component: Settings },
    { path: '/video-rules', component: VideoRules },
    { path: '/debug', component: Debug },
    { path: '/reminder-popup', component: ReminderPopup },
    { path: '/reminder-fullscreen', component: ReminderFullscreen },
    { path: '/reminder-toast', component: ReminderToast },
  ],
})

export default router
