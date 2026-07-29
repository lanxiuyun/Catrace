import {
  defineAsyncComponent,
  markRaw,
  type Component,
} from 'vue'
import {
  getPluginSettingsSource,
  getPluginUiSource,
  listExternalPlugins,
  type ExternalPluginInfo,
} from '../api/tauri'
import { usePluginRegistry, type PluginHandle } from '../stores/pluginRegistry'
import { ensurePluginRuntime } from './pluginRuntime'

const blobUrlByPlugin = new Map<string, string>()
const settingsBlobUrlByPlugin = new Map<string, string>()
/** Single-flight: concurrent callers share one scan (toast + main + refresh). */
let inflight: Promise<ExternalPluginInfo[]> | null = null
/** Skip full rebuild when list fingerprint matches last successful load. */
let lastFingerprint = ''

function fingerprint(list: ExternalPluginInfo[]): string {
  return list
    .filter((p) => !p.error)
    .map(
      (p) =>
        `${p.id}@${p.version}:${p.enabled ? 1 : 0}:${p.main || ''}:${p.hasUi ? 1 : 0}:${p.hasSettings ? 1 : 0}:${p.settings || ''}`,
    )
    .sort()
    .join('|')
}

function revokeBlob(map: Map<string, string>, pluginId: string, next?: string) {
  const prev = map.get(pluginId)
  if (next) map.set(pluginId, next)
  else map.delete(pluginId)
  if (prev && prev !== next) {
    try {
      URL.revokeObjectURL(prev)
    } catch {
      /* ignore */
    }
  }
}

async function buildComponentFromSource(
  pluginId: string,
  source: string,
  map: Map<string, string>,
  exportNames: string[],
): Promise<Component> {
  const blob = new Blob([source], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  revokeBlob(map, pluginId, blobUrl)

  return markRaw(
    defineAsyncComponent({
      loader: async () => {
        const mod: Record<string, unknown> = await import(/* @vite-ignore */ blobUrl)
        let comp: Component | undefined
        for (const name of exportNames) {
          if (mod[name]) {
            comp = mod[name] as Component
            break
          }
        }
        if (!comp) {
          throw new Error(`plugin ${pluginId}: no ${exportNames.join('/')} export`)
        }
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
  ensurePluginRuntime()
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
    // Registry already holds the same set — avoid revoke/reimport thrash.
    return list
  }

  for (const name of registry.listExternalNames()) {
    registry.unregister(name)
  }

  for (const p of list) {
    if (p.error) continue

    let CardComponent: Component | undefined
    let SettingsComponent: Component | undefined
    let uiUrl: string | undefined

    // Toast card only for enabled plugins (bg won't publish when disabled).
    if (p.enabled && p.hasUi) {
      try {
        const source = await getPluginUiSource(p.id)
        CardComponent = await buildComponentFromSource(p.id, source, blobUrlByPlugin, [
          'default',
          'Card',
          'card',
        ])
        uiUrl = blobUrlByPlugin.get(p.id)
      } catch (e) {
        console.warn(`[plugins] ui load failed for ${p.id}`, e)
      }
    } else {
      revokeBlob(blobUrlByPlugin, p.id)
    }

    // Settings available even when disabled so Plugins page can show the panel.
    if (p.hasSettings) {
      try {
        const source = await getPluginSettingsSource(p.id)
        SettingsComponent = await buildComponentFromSource(
          p.id,
          source,
          settingsBlobUrlByPlugin,
          ['default', 'Settings', 'settings'],
        )
      } catch (e) {
        console.warn(`[plugins] settings load failed for ${p.id}`, e)
      }
    } else {
      revokeBlob(settingsBlobUrlByPlugin, p.id)
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
      SettingsComponent,
      settingsSurface: SettingsComponent ? 'plugins' : 'none',
      external: true,
      enabled: p.enabled,
      uiUrl,
    }
    registry.register(handle)
  }

  lastFingerprint = fp
  return list
}

/**
 * Discover local plugins via Rust, register into pluginRegistry.
 * Safe to call from main + toast windows (each has its own Pinia).
 *
 * UI/settings loading: Rust reads source → Blob URL → dynamic import.
 * Concurrent calls coalesce; unchanged fingerprint skips Blob rebuild.
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
