import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { BusEvent } from '../types/event'

const MAX_RESOLVED = 150

export const useEventHub = defineStore('eventHub', () => {
  const eventsById = ref<Map<string, BusEvent>>(new Map())
  const listeners = new Map<string, Set<(event: BusEvent) => void>>()
  let unlisten: (() => void) | null = null
  let started = false

  const events = computed(() => Array.from(eventsById.value.values()))
  const activeEvents = computed(() =>
    events.value
      .filter((e) => e.status === 'active')
      .sort((a, b) => a.created_at - b.created_at),
  )
  const resolvedEvents = computed(() =>
    events.value
      .filter((e) => e.status === 'resolved')
      .sort((a, b) => (b.resolved_at ?? b.updated_at) - (a.resolved_at ?? a.updated_at)),
  )

  function upsert(event: BusEvent) {
    const prev = eventsById.value.get(event.id)
    if (prev && (event.revision ?? 0) < (prev.revision ?? 0)) {
      return
    }
    const next = new Map(eventsById.value)
    next.set(event.id, event)
    // Bound resolved history
    const resolved = Array.from(next.values())
      .filter((e) => e.status === 'resolved')
      .sort((a, b) => (a.resolved_at ?? a.updated_at) - (b.resolved_at ?? b.updated_at))
    if (resolved.length > MAX_RESOLVED) {
      const drop = resolved.length - MAX_RESOLVED
      for (let i = 0; i < drop; i++) {
        next.delete(resolved[i].id)
      }
    }
    eventsById.value = next

    const wildcard = listeners.get('*')
    wildcard?.forEach((fn) => fn(event))
    listeners.get(event.event_type)?.forEach((fn) => fn(event))
    listeners.get(`kind:${event.kind}`)?.forEach((fn) => fn(event))
  }

  async function startListening() {
    if (started) return
    started = true
    unlisten = await listen<BusEvent>('catrace:event', (tauriEvent) => {
      upsert(tauriEvent.payload)
    })
    try {
      const active = await invoke<BusEvent[]>('get_active_events')
      for (const e of active) upsert(e)
    } catch (e) {
      console.warn('[eventHub] get_active_events failed', e)
    }
  }

  function stopListening() {
    unlisten?.()
    unlisten = null
    started = false
  }

  function on(eventType: string, handler: (event: BusEvent) => void) {
    if (!listeners.has(eventType)) {
      listeners.set(eventType, new Set())
    }
    listeners.get(eventType)!.add(handler)
    return () => listeners.get(eventType)?.delete(handler)
  }

  function getById(id: string) {
    return eventsById.value.get(id)
  }

  /** Local-only remove from hub (does not resolve on backend). */
  function consume(id: string) {
    if (!eventsById.value.has(id)) return
    const next = new Map(eventsById.value)
    next.delete(id)
    eventsById.value = next
  }

  return {
    events,
    activeEvents,
    resolvedEvents,
    startListening,
    stopListening,
    on,
    getById,
    consume,
  }
})
