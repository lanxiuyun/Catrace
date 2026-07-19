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

export interface PluginHandle {
  manifest: PluginManifest
  onEvent: (event: BusEvent) => void
  CardComponent?: Component
  SettingsComponent?: Component
  settingsKey?: string
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
    const name = cardKindMap.value.get(kind) || cardKindMap.value.get(`kind:${kind}`)
    return name ? pluginMap.value.get(name) : undefined
  }

  function getSettingsPlugins(): PluginHandle[] {
    return Array.from(pluginMap.value.values())
      .filter(p => p.SettingsComponent)
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
