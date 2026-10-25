import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import '@radix-ui/themes/styles.css'
import '../styles/theme.css'
import './legacy/legacy.css'
import './shell/shell.css'
import { createAppRouter } from './router'
import { bootstrap } from './bootstrap'
import { normalizeReminderHash } from './preflight'

/**
 * React 壳入口（取代 src/main.ts / App.vue）。
 * 迁移期：壳与路由是 React，页面仍是 Vue 岛（见 ./legacy）。
 */

// 必须在 createHashRouter 之前把旧的 ?reminder= 形式归一成 hash 路由。
normalizeReminderHash()

const router = createAppRouter()

function AppRoot() {
  // Radix Theme 的 provider 在 MainShell 顶栏内部局部使用（见 shell/MainShell.tsx），
  // 迁移期不让它包住整个应用，避免影响 Vue 岛的 naive-ui 样式。
  return <RouterProvider router={router} />
}

const container = document.getElementById('app')
if (!container) {
  throw new Error('Catrace: #app container not found')
}

const root = createRoot(container)

void bootstrap()
  .catch((error) => console.warn('[app] bootstrap failed', error))
  .finally(() => {
    root.render(<AppRoot />)
  })
