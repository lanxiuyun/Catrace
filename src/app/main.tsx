import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import '../styles/theme.css'
import './radix-theme.css'
import './legacy/legacy.css'
import './shell/shell.css'
import { createAppRouter } from './router'
import { bootstrap } from './bootstrap'
import { detectWindowMode, normalizeReminderHash } from './preflight'
import { useShellStore } from './store'

/**
 * React 壳入口（取代 src/main.ts / App.vue）。
 * 迁移期：壳与路由是 React，页面仍是 Vue 岛（见 ./legacy）。
 */

// 必须在 createHashRouter 之前把旧的 ?reminder= 形式归一成 hash 路由。
normalizeReminderHash()

const windowMode = detectWindowMode()
const router = createAppRouter()

function AppRoot() {
  const appearance = useShellStore((state) => state.resolvedTheme)

  // 主窗：整个 React 树放在一个 Radix 根主题下（白色主题 + indigo 强调），
  // 侧栏/顶栏/页面不再各自建 Theme，避免"根主题 min-height:100vh"把局部容器撑满。
  // Toast / 弹窗窗全是 Vue 岛，不需要 Radix 主题。
  if (windowMode !== 'main') {
    return <RouterProvider router={router} />
  }

  return (
    <Theme
      appearance={appearance}
      accentColor="iris"
      grayColor="slate"
      radius="large"
      scaling="100%"
      hasBackground={false}
    >
      <RouterProvider router={router} />
    </Theme>
  )
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
