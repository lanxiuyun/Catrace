import { defineStore } from 'pinia'
import { ref, computed, type Component } from 'vue'
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
}

export const usePluginRegistry = defineStore('pluginRegistry', () => {
  const pluginMap = ref<Map<string, PluginHandle>>(new Map())
  const cardKindMap = ref<Map<string, string>>(new Map()) // kind -> plugin name

  function register(handle: PluginHandle) {
    pluginMap.value.set(handle.manifest.name, handle)

    if (handle.CardComponent) {
      for (const eventType of handle.manifest.events) {
        cardKindMap.value.set(eventType, handle.manifest.name)
      }
    }
  }

  function getPlugin(name: string): PluginHandle | undefined {
    return pluginMap.value.get(name)
  }

  function getPluginForKind(kind: string): PluginHandle | undefined {
    // kind 直接匹配，或 kind:xxx / event_type 前缀
    const direct = cardKindMap.value.get(kind) || cardKindMap.value.get(`kind:${kind}`)
    if (direct) return pluginMap.value.get(direct)
    // fallback: scan manifests
    for (const p of pluginMap.value.values()) {
      if (p.manifest.events.includes(kind) || p.manifest.events.includes(`kind:${kind}`)) {
        return p
      }
      if (p.manifest.name === kind) return p
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

  const hasSettingsPlugins = computed(() => getSettingsPlugins().length > 0)

  return {
    pluginMap,
    register,
    getPlugin,
    getPluginForKind,
    getSettingsPlugins,
    getCardComponent,
    hasSettingsPlugins,
  }
})
