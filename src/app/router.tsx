import { createHashRouter, Navigate } from 'react-router-dom'
import type { Component } from 'vue'
import { MainShell } from './shell/MainShell'
import { ToastShell } from './shell/ToastShell'
import { VueIsland } from './legacy/VueIsland'
import { Dashboard } from './pages/Dashboard'
import { Plugins } from './pages/Plugins'
import Settings from '../views/mainWindow/Settings.vue'
import Debug from '../views/mainWindow/Debug.vue'
import ReminderToast from '../views/toastWindows/ReminderToast.vue'
import ReminderPopup from '../views/toastWindows/ReminderPopup.vue'
import ReminderFullscreen from '../views/toastWindows/ReminderFullscreen.vue'
import PluginHost from '../views/toastWindows/PluginHost.vue'

/**
 * React 路由表，hash 模式，路径与 Tauri 建窗 URL 完全一致：
 *   index.html#/dashboard、#/reminder-toast、?plugin_id=x#/plugin-host ...
 * 迁移期页面仍以 Vue 岛挂载；迁完一个页面就把它换成 React 组件。
 */
function mainPage(Page: Component) {
  return (
    <MainShell>
      <VueIsland component={Page} className="vue-island-page" />
    </MainShell>
  )
}

function toastPage(Page: Component) {
  return (
    <ToastShell>
      <VueIsland component={Page} className="vue-island-toast" />
    </ToastShell>
  )
}

export function createAppRouter() {
  return createHashRouter([
    {
      path: '/dashboard',
      element: (
        <MainShell>
          <Dashboard />
        </MainShell>
      ),
    },
    {
      path: '/plugins',
      element: (
        <MainShell>
          <Plugins />
        </MainShell>
      ),
    },
    { path: '/settings', element: mainPage(Settings) },
    { path: '/debug', element: mainPage(Debug) },

    { path: '/reminder-toast', element: toastPage(ReminderToast) },
    { path: '/reminder-popup', element: toastPage(ReminderPopup) },
    { path: '/reminder-fullscreen', element: toastPage(ReminderFullscreen) },
    { path: '/plugin-host', element: toastPage(PluginHost) },

    { path: '/', element: <Navigate to="/dashboard" replace /> },
    { path: '*', element: <Navigate to="/dashboard" replace /> },
  ])
}
