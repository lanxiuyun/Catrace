import { createHashRouter, Navigate } from 'react-router-dom'
import { MainShell } from './shell/MainShell'
import { ToastShell } from './shell/ToastShell'
import { Dashboard } from './pages/Dashboard'
import { Plugins } from './pages/Plugins'
import { Settings } from './pages/Settings'
import { Debug } from './pages/Debug'
import ReminderToast from './windows/ReminderToast'
import ReminderPopup from './windows/ReminderPopup'
import ReminderFullscreen from './windows/ReminderFullscreen'
import PluginHost from './windows/PluginHost'

/** All windows use React; hash routes stay aligned with the native window URLs. */
export function createAppRouter() {
  return createHashRouter([
    {
      path: '/',
      element: <MainShell />,
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: 'dashboard', element: <Dashboard /> },
        { path: 'plugins', element: <Plugins /> },
        { path: 'settings', element: <Settings /> },
        { path: 'debug', element: <Debug /> },
      ],
    },
    { path: '/reminder-toast', element: <ToastShell><ReminderToast /></ToastShell> },
    { path: '/reminder-popup', element: <ToastShell><ReminderPopup /></ToastShell> },
    { path: '/reminder-fullscreen', element: <ToastShell><ReminderFullscreen /></ToastShell> },
    { path: '/plugin-host', element: <ToastShell><PluginHost /></ToastShell> },
    { path: '*', element: <Navigate to="/dashboard" replace /> },
  ])
}
