import type { Component } from 'vue'

/** Process-wide cache for plugin toast card components (toast window). */
const cardCache = new Map<string, Component>()

export function getPluginHostCardCache(): Map<string, Component> {
  return cardCache
}

export function clearPluginHostCardCache() {
  cardCache.clear()
}
