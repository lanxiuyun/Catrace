import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import '../styles/theme.css'
import './radix-theme.css'
import './base.css'
import './shell/shell.css'
import { createAppRouter } from './router'
import { bootstrap } from './bootstrap'
import { normalizeReminderHash } from './preflight'
import { useShellStore } from './store'

// Native windows share one HTML entry and retain their established hash URLs.
normalizeReminderHash()
const router = createAppRouter()

function AppRoot() {
  const appearance = useShellStore((state) => state.resolvedTheme)
  return (
    <Theme
      className="ct-root-theme"
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
if (!container) throw new Error('Catrace: #app container not found')
const root = createRoot(container)

void bootstrap()
  .catch((error) => console.warn('[app] bootstrap failed', error))
  .finally(() => { root.render(<AppRoot />) })
