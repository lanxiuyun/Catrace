import { useSyncExternalStore, type ComponentType } from 'react'
import type { PluginCardProps } from '../stores/pluginRegistry'

/** Cache is local to a WebView; registry enable state remains authoritative. */
const cardCache = new Map<string, ComponentType<PluginCardProps>>()
let generation = 0
const listeners = new Set<() => void>()

export function getPluginHostCardCache(): Map<string, ComponentType<PluginCardProps>> {
  return cardCache
}

export function getPluginHostCardCacheGeneration(): number {
  return generation
}

export function subscribePluginHostCardCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function usePluginHostCardCacheGeneration(): number {
  return useSyncExternalStore(subscribePluginHostCardCache, getPluginHostCardCacheGeneration, getPluginHostCardCacheGeneration)
}

export function clearPluginHostCardCache(): void {
  cardCache.clear()
  generation += 1
  for (const listener of listeners) listener()
}
