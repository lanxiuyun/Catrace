import { ref, type Component, type Ref } from 'vue'

/** Process-wide cache for plugin toast card components (toast window). */
const cardCache = new Map<string, Component>()
/** Bumped on clear so mounted PluginHostCards re-resolve after hot reload. */
const cardCacheGeneration = ref(0)

export function getPluginHostCardCache(): Map<string, Component> {
  return cardCache
}

export function getPluginHostCardCacheGeneration(): Ref<number> {
  return cardCacheGeneration
}

export function clearPluginHostCardCache() {
  cardCache.clear()
  cardCacheGeneration.value += 1
}
