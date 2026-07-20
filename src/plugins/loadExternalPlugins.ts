import {
  computed,
  defineAsyncComponent,
  h,
  markRaw,
  ref,
  watch,
  type Component,
} from 'vue'
import {
  getPluginUiSource,
  listExternalPlugins,
  type ExternalPluginInfo,
} from '../api/tauri'
import { usePluginRegistry, type PluginHandle } from '../stores/pluginRegistry'

/** Expose a minimal Vue runtime for external ESM cards (bare `vue` import won't resolve). */
function ensurePluginVueRuntime() {
  const g = globalThis as typeof globalThis & {
    __CATRACE_VUE__?: Record<string, unknown>
  }
  if (!g.__CATRACE_VUE__) {
    g.__CATRACE_VUE__ = { h, ref, computed, watch, markRaw }
  }
}

const blobUrlByPlugin = new Map<string, string>()

async function buildCardFromSource(pluginId: string, source: string): Promise<Component> {
  // Revoke previous blob for this plugin (reload path).
  const prev = blobUrlByPlugin.get(pluginId)
  if (prev) {
    try {
      URL.revokeObjectURL(prev)
    } catch {
      /* ignore */
    }
  }

  const blob = new Blob([source], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  blobUrlByPlugin.set(pluginId, blobUrl)

  return markRaw(
    defineAsyncComponent({
      loader: async () => {
        const mod: Record<string, unknown> = await import(/* @vite-ignore */ blobUrl)
        const comp = (mod.default || mod.Card || mod.card) as Component | undefined
        if (!comp) throw new Error(`plugin ${pluginId}: no default/Card export`)
        return markRaw(comp as object) as Component
      },
      delay: 0,
      timeout: 10000,
      onError(err, _retry, fail) {
        console.warn(`[plugins] async load failed for ${pluginId}`, err)
        fail()
      },
    }),
  )
}

/**
 * Discover local plugins via Rust, register enabled ones (with optional Card) into pluginRegistry.
 * Safe to call from main + toast windows (each has its own Pinia).
 *
 * UI loading strategy: read ui.mjs text from Rust → Blob URL → dynamic import.
 * Avoids asset:// / file:// ESM import failures in Tauri WebView.
 */
export async function loadExternalPlugins(): Promise<ExternalPluginInfo[]> {
  ensurePluginVueRuntime()
  const registry = usePluginRegistry()
  let list: ExternalPluginInfo[] = []
  try {
    list = await listExternalPlugins()
  } catch (e) {
    console.warn('[plugins] list_external_plugins failed', e)
    return []
  }

  // Drop previously registered external plugins before re-adding.
  for (const name of registry.listExternalNames()) {
    registry.unregister(name)
  }

  for (const p of list) {
    if (p.error || !p.enabled) continue

    let CardComponent: Component | undefined
    let uiUrl: string | undefined
    if (p.hasUi) {
      try {
        const source = await getPluginUiSource(p.id)
        CardComponent = await buildCardFromSource(p.id, source)
        uiUrl = blobUrlByPlugin.get(p.id)
      } catch (e) {
        console.warn(`[plugins] ui load failed for ${p.id}`, e)
      }
    }

    const handle: PluginHandle = {
      manifest: {
        name: p.id,
        version: p.version,
        displayName: p.name,
        description: p.description,
        events: p.events.length ? p.events : [`kind:${p.id}`, p.id],
        permissions: p.permissions,
        builtin: false,
      },
      onEvent: () => {},
      CardComponent,
      settingsSurface: 'none',
      external: true,
      enabled: true,
      uiUrl,
    }
    registry.register(handle)
  }

  return list
}
