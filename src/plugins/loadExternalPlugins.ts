import type { ComponentType } from 'react'
import {
  getPluginSettingsSource,
  getPluginUiSource,
  listExternalPlugins,
  type ExternalPluginInfo,
} from '../api/tauri'
import { usePluginRegistry, type PluginCardProps, type PluginHandle } from '../stores/pluginRegistry'
import { ensurePluginRuntime } from './pluginRuntime'
import { wrapPluginSource } from './pluginApi'
import { isPluginComponent } from './pluginComponent'

const blobUrlByPlugin = new Map<string, string>()
const settingsBlobUrlByPlugin = new Map<string, string>()
/** Single-flight: concurrent callers share one reload queue per WebView. */
let inflight: Promise<ExternalPluginInfo[]> | null = null
/** A persisted change during a scan must not be lost to single-flight coalescing. */
let reloadRequested = false
let forceRequested = false
/** Skip full rebuild when list fingerprint matches last successful load. */
let lastFingerprint = ''

function fingerprint(list: ExternalPluginInfo[]): string {
  return list
    .filter((p) => !p.error)
    .map((p) => {
      // mtime so disk edits to ui/settings bust the skip-rebuild short-circuit.
      const mtime =
        typeof (p as ExternalPluginInfo & { contentMtimeMs?: number }).contentMtimeMs === 'number'
          ? (p as ExternalPluginInfo & { contentMtimeMs?: number }).contentMtimeMs
          : 0
      return `${p.id}@${p.version}:${p.enabled ? 1 : 0}:${p.main || ''}:${p.hasUi ? 1 : 0}:${p.hasSettings ? 1 : 0}:${p.settings || ''}:m${mtime}`
    })
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

async function buildComponentFromSource<P>(
  pluginId: string,
  source: string,
  map: Map<string, string>,
  exportNames: string[],
): Promise<ComponentType<P>> {
  const blob = new Blob([wrapPluginSource(pluginId, source)], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  revokeBlob(map, pluginId, blobUrl)

  try {
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ blobUrl)
    for (const name of exportNames) {
      if (isPluginComponent<P>(mod[name])) return mod[name]
    }
    throw new Error(`plugin ${pluginId}: no ${exportNames.join('/')} export`)
  } catch (error) {
    revokeBlob(map, pluginId)
    throw error
  }
}

async function loadExternalPluginsInner(force: boolean): Promise<ExternalPluginInfo[]> {
  ensurePluginRuntime()
  const registry = usePluginRegistry.getState()
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

  const previousNames = new Set(registry.listExternalNames())

  for (const p of list) {
    if (p.error) continue

    let CardComponent: ComponentType<PluginCardProps> | undefined
    let SettingsComponent: ComponentType | undefined
    let uiUrl: string | undefined

    // Toast card only for enabled plugins (bg won't publish when disabled).
    if (p.enabled && p.hasUi) {
      try {
        const source = await getPluginUiSource(p.id)
        CardComponent = await buildComponentFromSource<PluginCardProps>(p.id, source, blobUrlByPlugin, [
          'default',
          'Card',
          'card',
        ])
        uiUrl = blobUrlByPlugin.get(p.id)
      } catch (e) {
        revokeBlob(blobUrlByPlugin, p.id)
        console.warn(`[plugins] ui load failed for ${p.id}`, e)
      }
    } else {
      revokeBlob(blobUrlByPlugin, p.id)
    }

    // Importing settings executes plugin code too: disabled means not trusted yet.
    if (p.enabled && p.hasSettings) {
      try {
        const source = await getPluginSettingsSource(p.id)
        SettingsComponent = await buildComponentFromSource(
          p.id,
          source,
          settingsBlobUrlByPlugin,
          ['default', 'Settings', 'settings'],
        )
      } catch (e) {
        revokeBlob(settingsBlobUrlByPlugin, p.id)
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
    previousNames.delete(p.id)
  }

  for (const name of previousNames) {
    registry.unregister(name)
    revokeBlob(blobUrlByPlugin, name)
    revokeBlob(settingsBlobUrlByPlugin, name)
  }

  lastFingerprint = fp
  return list
}

/**
 * Discover local plugins via Rust, register into pluginRegistry.
 * Safe to call from main + toast windows (each has its own registry).
 *
 * UI/settings loading: Rust reads source → Blob URL → dynamic import.
 * Concurrent calls coalesce; unchanged fingerprint skips Blob rebuild.
 * Disk edits to ui/settings change contentMtimeMs and rebuild automatically.
 */
export async function loadExternalPlugins(
  opts: { force?: boolean } = {},
): Promise<ExternalPluginInfo[]> {
  if (inflight) {
    // A lifecycle event may arrive after the in-flight scan read the old state.
    reloadRequested = true
    forceRequested ||= !!opts.force
    return inflight
  }
  inflight = (async () => {
    let force = !!opts.force
    let list: ExternalPluginInfo[]
    do {
      reloadRequested = false
      forceRequested = false
      list = await loadExternalPluginsInner(force)
      force = forceRequested
    } while (reloadRequested)
    return list
  })().finally(() => {
    inflight = null
  })
  return inflight
}
