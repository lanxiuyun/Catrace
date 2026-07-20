import { defineStore } from 'pinia'
import { ref, computed, markRaw, type Component } from 'vue'
import type { BusEvent } from '../types/event'

export interface PluginManifest {
  name: string
  version: string
  displayName: string
  description: string
  events: string[]
  permissions: string[]
  builtin?: boolean
}

/** Where a plugin's SettingsComponent should be mounted. */
export type PluginSettingsSurface = 'settings' | 'plugins' | 'none'

export interface PluginHandle {
  manifest: PluginManifest
  onEvent: (event: BusEvent) => void
  CardComponent?: Component
  SettingsComponent?: Component
  /** Stable key used in settings drag-order store (`settings_group_order`). */
  settingsKey?: string
  /**
   * - settings: appear as a card on the system Settings page
   * - plugins: detail panel on the Plugins page only
   * - none: registered for bus/events but no UI surface yet
   */
  settingsSurface?: PluginSettingsSurface
  /** External (disk) plugin. */
  external?: boolean
  enabled?: boolean
  uiUrl?: string
}

export const usePluginRegistry = defineStore('pluginRegistry', () => {
  const pluginMap = ref<Map<string, PluginHandle>>(new Map())
  const cardKindMap = ref<Map<string, string>>(new Map()) // kind/event -> plugin name

  function register(handle: PluginHandle) {
    // Replace existing mapping for this name.
    const prev = pluginMap.value.get(handle.manifest.name)
    if (prev?.CardComponent) {
      for (const [k, v] of [...cardKindMap.value.entries()]) {
        if (v === handle.manifest.name) cardKindMap.value.delete(k)
      }
    }

    if (handle.CardComponent) {
      handle.CardComponent = markRaw(handle.CardComponent)
    }
    if (handle.SettingsComponent) {
      handle.SettingsComponent = markRaw(handle.SettingsComponent)
    }

    pluginMap.value.set(handle.manifest.name, handle)

    if (handle.CardComponent || handle.external) {
      for (const eventType of handle.manifest.events) {
        cardKindMap.value.set(eventType, handle.manifest.name)
        if (eventType.startsWith('kind:')) {
          cardKindMap.value.set(eventType.slice(5), handle.manifest.name)
        } else {
          // bare id also maps as kind
          cardKindMap.value.set(eventType, handle.manifest.name)
        }
      }
      // Always map plugin id as kind so toast can resolve by event.kind === id
      cardKindMap.value.set(handle.manifest.name, handle.manifest.name)
    }
  }

  function unregister(name: string) {
    const prev = pluginMap.value.get(name)
    if (!prev) return
    pluginMap.value.delete(name)
    for (const [k, v] of [...cardKindMap.value.entries()]) {
      if (v === name) cardKindMap.value.delete(k)
    }
  }

  function getPlugin(name: string): PluginHandle | undefined {
    return pluginMap.value.get(name)
  }

  function getPluginForKind(kind: string): PluginHandle | undefined {
    const direct = cardKindMap.value.get(kind) || cardKindMap.value.get(`kind:${kind}`)
    if (direct) return pluginMap.value.get(direct)
    for (const p of pluginMap.value.values()) {
      if (p.manifest.events.includes(kind) || p.manifest.events.includes(`kind:${kind}`)) {
        return p
      }
      if (p.manifest.name === kind) return p
      // prefix: kind "demo-timer.tick" matches plugin "demo-timer"
      if (
        p.external &&
        (kind === p.manifest.name || kind.startsWith(`${p.manifest.name}.`))
      ) {
        return p
      }
    }
    return undefined
  }

  function getSettingsPlugins(surface: PluginSettingsSurface = 'settings'): PluginHandle[] {
    return Array.from(pluginMap.value.values()).filter((p) => {
      if (!p.SettingsComponent) return false
      const s = p.settingsSurface ?? 'settings'
      return s === surface
    })
  }

  function getCardComponent(kind: string): Component | undefined {
    const plugin = getPluginForKind(kind)
    return plugin?.CardComponent
  }

  function enabledKinds(): string[] {
    const kinds = new Set<string>()
    for (const p of pluginMap.value.values()) {
      if (p.external && p.enabled === false) continue
      kinds.add(p.manifest.name)
      for (const ev of p.manifest.events) {
        if (ev.startsWith('kind:')) kinds.add(ev.slice(5))
        else kinds.add(ev)
      }
    }
    return [...kinds]
  }

  function listExternal(): PluginHandle[] {
    return Array.from(pluginMap.value.values()).filter((p) => p.external)
  }

  function listExternalNames(): string[] {
    return listExternal().map((p) => p.manifest.name)
  }

  const hasSettingsPlugins = computed(() => getSettingsPlugins().length > 0)

  return {
    pluginMap,
    register,
    unregister,
    getPlugin,
    getPluginForKind,
    getSettingsPlugins,
    getCardComponent,
    hasSettingsPlugins,
    enabledKinds,
    listExternal,
    listExternalNames,
  }
})
