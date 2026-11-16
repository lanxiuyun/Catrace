import { create } from 'zustand'
import type { ComponentType } from 'react'
import type { BusEvent } from '../types/event'

export interface PluginManifest {
  name: string
  version: string
  displayName: string
  description: string
  events: string[]
  builtin?: boolean
}

export type PluginSettingsSurface = 'settings' | 'plugins' | 'none'

export interface PluginCardProps {
  event: BusEvent
  isHovered?: boolean
  remainingMs?: number
  totalMs?: number
  onClose?: () => void
  onAction?: (actionId: string, payload?: unknown) => void
}

export type PluginCardComponent = ComponentType<PluginCardProps>
export type PluginSettingsComponent = ComponentType

export interface PluginHandle {
  manifest: PluginManifest
  onEvent: (event: BusEvent) => void
  CardComponent?: PluginCardComponent
  SettingsComponent?: PluginSettingsComponent
  settingsKey?: string
  settingsSurface?: PluginSettingsSurface
  external?: boolean
  enabled?: boolean
  uiUrl?: string
}

interface PluginRegistryState {
  pluginMap: Map<string, PluginHandle>
  cardKindMap: Map<string, string>
  hasSettingsPlugins: boolean
  register: (handle: PluginHandle) => void
  unregister: (name: string) => void
  getPlugin: (name: string) => PluginHandle | undefined
  getPluginForKind: (kind: string) => PluginHandle | undefined
  getSettingsPlugins: (surface?: PluginSettingsSurface) => PluginHandle[]
  getCardComponent: (kind: string) => PluginCardComponent | undefined
  enabledKinds: () => string[]
  listExternal: () => PluginHandle[]
  listExternalNames: () => string[]
}

const hasSettings = (plugins: Map<string, PluginHandle>) =>
  [...plugins.values()].some((plugin) => plugin.SettingsComponent
    && (plugin.settingsSurface ?? 'settings') === 'settings')

/** React selectors subscribe normally; non-React callers use usePluginRegistry.getState(). */
export const usePluginRegistry = create<PluginRegistryState>((set, get) => ({
  pluginMap: new Map(),
  cardKindMap: new Map(),
  hasSettingsPlugins: false,
  register: (handle) => {
    const pluginMap = new Map(get().pluginMap)
    const cardKindMap = new Map(get().cardKindMap)
    const name = handle.manifest.name
    for (const [kind, owner] of cardKindMap) {
      if (owner === name) cardKindMap.delete(kind)
    }
    pluginMap.set(name, handle)
    if (handle.CardComponent || handle.external) {
      for (const eventType of handle.manifest.events) {
        cardKindMap.set(eventType, name)
        if (eventType.startsWith('kind:')) cardKindMap.set(eventType.slice(5), name)
      }
      cardKindMap.set(name, name)
    }
    set({ pluginMap, cardKindMap, hasSettingsPlugins: hasSettings(pluginMap) })
  },
  unregister: (name) => {
    if (!get().pluginMap.has(name)) return
    const pluginMap = new Map(get().pluginMap)
    const cardKindMap = new Map(get().cardKindMap)
    pluginMap.delete(name)
    for (const [kind, owner] of cardKindMap) {
      if (owner === name) cardKindMap.delete(kind)
    }
    set({ pluginMap, cardKindMap, hasSettingsPlugins: hasSettings(pluginMap) })
  },
  getPlugin: (name) => get().pluginMap.get(name),
  getPluginForKind: (kind) => {
    const { pluginMap, cardKindMap } = get()
    const direct = cardKindMap.get(kind) || cardKindMap.get(`kind:${kind}`)
    if (direct) return pluginMap.get(direct)
    for (const plugin of pluginMap.values()) {
      if (plugin.manifest.events.includes(kind)
        || plugin.manifest.events.includes(`kind:${kind}`)
        || plugin.manifest.name === kind
        || (plugin.external && kind.startsWith(`${plugin.manifest.name}.`))) {
        return plugin
      }
    }
    return undefined
  },
  getSettingsPlugins: (surface = 'settings') => [...get().pluginMap.values()]
    .filter((plugin) => plugin.SettingsComponent
      && (plugin.settingsSurface ?? 'settings') === surface),
  getCardComponent: (kind) => get().getPluginForKind(kind)?.CardComponent,
  enabledKinds: () => {
    const kinds = new Set<string>()
    for (const plugin of get().pluginMap.values()) {
      if (plugin.external && plugin.enabled === false) continue
      kinds.add(plugin.manifest.name)
      for (const eventType of plugin.manifest.events) {
        kinds.add(eventType.startsWith('kind:') ? eventType.slice(5) : eventType)
      }
    }
    return [...kinds]
  },
  listExternal: () => [...get().pluginMap.values()].filter((plugin) => plugin.external),
  listExternalNames: () => get().listExternal().map((plugin) => plugin.manifest.name),
}))
