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
/** Single-flight: concurrent callers share one scan (toast + main + refresh). */
let inflight: Promise<ExternalPluginInfo[]> | null = null
/** Skip full rebuild when list fingerprint matches last successful load. */
let lastFingerprint = ''

function fingerprint(list: ExternalPluginInfo[]): string {
  return list
    .filter((p) => !p.error && p.enabled)
    .map((p) => `${p.id}@${p.version}:${p.main || ''}:${p.hasUi ? 1 : 0}`)
    .sort()
    .join('|')
}

async function buildCardFromSource(pluginId: string, source: string): Promise<Component> {
  const blob = new Blob([source], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  const prev = blobUrlByPlugin.get(pluginId)
  blobUrlByPlugin.set(pluginId, blobUrl)
  // Revoke AFTER swapping the map entry so a brief race still has a valid URL if needed.
  if (prev && prev !== blobUrl) {
    try {
      URL.revokeObjectURL(prev)
    } catch {
      /* ignore */
    }
  }

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

async function loadExternalPluginsInner(force: boolean): Promise<ExternalPluginInfo[]> {
  ensurePluginVueRuntime()
  const registry = usePluginRegistry()
  let list: ExternalPluginInfo[] = []
  try {
    list = await listExternalPlugins()
  } catch (e) {
    console.warn('[plugins] list_external_plugins failed', e)
    return []
  }

  const fp = fingerprint(list)
  if (!force && fp === lastFingerprint && fp !== '') {
    // Registry already holds the same enabled set — avoid revoke/reimport thrash.
    return list
  }

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

  lastFingerprint = fp
  return list
}

/**
 * Discover local plugins via Rust, register enabled ones (with optional Card) into pluginRegistry.
 * Safe to call from main + toast windows (each has its own Pinia).
 *
 * UI loading: Rust reads ui.mjs → Blob URL → dynamic import (not file/asset).
 * Concurrent calls coalesce; unchanged enabled set skips Blob rebuild.
 */
export async function loadExternalPlugins(
  opts: { force?: boolean } = {},
): Promise<ExternalPluginInfo[]> {
  if (inflight) return inflight
  inflight = loadExternalPluginsInner(!!opts.force).finally(() => {
    inflight = null
  })
  return inflight
}
