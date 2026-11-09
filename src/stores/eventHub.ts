import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { BusEvent } from '../types/event'

const MAX_RESOLVED = 150

interface EventHubState {
  eventsById: Map<string, BusEvent>
  events: BusEvent[]
  activeEvents: BusEvent[]
  resolvedEvents: BusEvent[]
  startListening: () => Promise<void>
  stopListening: () => void
  on: (eventType: string, handler: (event: BusEvent) => void) => () => void
  getById: (id: string) => BusEvent | undefined
  consume: (id: string) => void
}

function snapshot(eventsById: Map<string, BusEvent>) {
  const events = [...eventsById.values()]
  return {
    eventsById,
    events,
    activeEvents: events.filter((event) => event.status === 'active')
      .sort((a, b) => a.created_at - b.created_at),
    resolvedEvents: events.filter((event) => event.status === 'resolved')
      .sort((a, b) => (b.resolved_at ?? b.updated_at) - (a.resolved_at ?? a.updated_at)),
  }
}

/** Observes the bus; rendering a second Toast is deliberately outside this store. */
export const useEventHub = create<EventHubState>((set, get) => {
  const listeners = new Map<string, Set<(event: BusEvent) => void>>()
  let unlisten: (() => void) | null = null
  let startPromise: Promise<void> | null = null
  let generation = 0

  const upsert = (event: BusEvent) => {
    const previous = get().eventsById.get(event.id)
    if (previous && (event.revision ?? 0) < (previous.revision ?? 0)) return
    const next = new Map(get().eventsById)
    next.set(event.id, event)
    const resolved = [...next.values()]
      .filter((entry) => entry.status === 'resolved')
      .sort((a, b) => (a.resolved_at ?? a.updated_at) - (b.resolved_at ?? b.updated_at))
    for (let index = 0; index < resolved.length - MAX_RESOLVED; index++) {
      next.delete(resolved[index].id)
    }
    set(snapshot(next))
    listeners.get('*')?.forEach((handler) => handler(event))
    listeners.get(event.event_type)?.forEach((handler) => handler(event))
    listeners.get(`kind:${event.kind}`)?.forEach((handler) => handler(event))
  }

  return {
    ...snapshot(new Map<string, BusEvent>()),
    startListening: () => {
      if (startPromise) return startPromise
      const current = ++generation
      startPromise = (async () => {
        const dispose = await listen<BusEvent>('catrace:event', (event) => {
          if (generation === current) upsert(event.payload)
        })
        if (generation !== current) {
          dispose()
          return
        }
        unlisten = dispose
        try {
          const active = await invoke<BusEvent[]>('get_active_events')
          if (generation === current) active.forEach(upsert)
        } catch (error) {
          console.warn('[eventHub] get_active_events failed', error)
        }
      })().catch((error) => {
        if (generation === current) startPromise = null
        throw error
      })
      return startPromise
    },
    stopListening: () => {
      generation++
      unlisten?.()
      unlisten = null
      startPromise = null
    },
    on: (eventType, handler) => {
      if (!listeners.has(eventType)) listeners.set(eventType, new Set())
      listeners.get(eventType)!.add(handler)
      return () => { listeners.get(eventType)?.delete(handler) }
    },
    getById: (id) => get().eventsById.get(id),
    consume: (id) => {
      if (!get().eventsById.has(id)) return
      const next = new Map(get().eventsById)
      next.delete(id)
      set(snapshot(next))
    },
  }
})
