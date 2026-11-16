import { Component, createElement, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import type { BusEvent } from '../types/event'
import { usePluginRegistry, type PluginCardProps, type PluginHandle } from '../stores/pluginRegistry'
import { getPluginUiSource } from '../api/tauri'
import { ensurePluginRuntime } from '../plugins/pluginRuntime'
import { wrapPluginSource } from '../plugins/pluginApi'
import { isPluginComponent } from '../plugins/pluginComponent'
import SdkToastCard from './SdkToastCard'
import { getPluginHostCardCache, getPluginHostCardCacheGeneration, usePluginHostCardCacheGeneration } from './pluginHostCardCache'

export interface PluginHostCardProps {
  event: BusEvent
  isHovered?: boolean
  remainingMs?: number
  totalMs?: number
  uiUrl?: string | null
  pluginId?: string | null
  onClose?: () => void
  onAction?: (actionId: string, payload?: unknown) => void
}

type CardComponent = ComponentType<PluginCardProps>
type LoadedCard = { owner: PluginHandle; generation: number; component?: CardComponent; failed?: boolean }
type PendingCard = { owner: PluginHandle; generation: number; promise: Promise<CardComponent | null> }
const cardCache = getPluginHostCardCache()
const cacheOwners = new Map<string, PluginHandle>()
const pendingCards = new Map<string, PendingCard>()
/** Only the shared React component export contract is accepted. */
const isReactComponent = isPluginComponent<PluginCardProps>

function isEnabled(handle: PluginHandle | undefined): handle is PluginHandle {
  return !!handle && (!handle.external || handle.enabled === true)
}

function isCurrent(id: string, owner: PluginHandle, generation: number): boolean {
  const current = usePluginRegistry.getState().getPlugin(id)
  return current === owner && isEnabled(current) && getPluginHostCardCacheGeneration() === generation
}

/** Only an enabled, unchanged registry owner may read or execute its module. */
function loadCard(id: string, owner: PluginHandle, generation: number): Promise<CardComponent | null> {
  const existing = pendingCards.get(id)
  if (existing?.owner === owner && existing.generation === generation) return existing.promise
  const deadline = Date.now() + 10_000
  const checkCurrent = () => isCurrent(id, owner, generation) && Date.now() < deadline
  const request = (async () => {
    if (!checkCurrent()) return null
    ensurePluginRuntime()
    const source = await getPluginUiSource(id)
    // A disable/uninstall while the source request was pending must not execute it.
    if (!checkCurrent()) return null
    const url = URL.createObjectURL(new Blob([wrapPluginSource(id, source)], { type: 'text/javascript' }))
    try {
      if (!checkCurrent()) return null
      const module: Record<string, unknown> = await import(/* @vite-ignore */ url)
      if (!checkCurrent()) return null
      const component = module.default || module.Card || module.card
      if (!isReactComponent(component)) throw new Error(`plugin ${id}: Card must export a React component`)
      cardCache.set(id, component)
      cacheOwners.set(id, owner)
      return component
    } finally {
      URL.revokeObjectURL(url)
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`plugin ${id}: card loading timed out`)), 10_000) })
  const promise = Promise.race([request, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
    if (pendingCards.get(id)?.promise === promise) pendingCards.delete(id)
  })
  pendingCards.set(id, { owner, generation, promise })
  return promise
}

class PluginCardBoundary extends Component<{ card: CardComponent; cardProps: PluginCardProps; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.warn('[PluginHostCard] render failed', error, info.componentStack) }
  componentDidUpdate(previous: Readonly<{ card: CardComponent }>) {
    if (previous.card !== this.props.card && this.state.failed) this.setState({ failed: false })
  }
  render() { return this.state.failed ? this.props.fallback : createElement(this.props.card, this.props.cardProps) }
}

export default function PluginHostCard(props: PluginHostCardProps) {
  const { event, isHovered, remainingMs, totalMs, onClose, onAction } = props
  const identity = props.pluginId || (event.source.type === 'plugin' ? event.source.name : '') || event.kind
  const handle = usePluginRegistry((state) => state.getPlugin(identity))
  const generation = usePluginHostCardCacheGeneration()
  const [loaded, setLoaded] = useState<LoadedCard | null>(null)
  const registered = isEnabled(handle) && isReactComponent(handle.CardComponent) ? handle.CardComponent : undefined
  const cached = isEnabled(handle) && cacheOwners.get(identity) === handle ? cardCache.get(identity) : undefined

  useEffect(() => {
    let alive = true
    if (!isEnabled(handle)) {
      cardCache.delete(identity)
      cacheOwners.delete(identity)
      setLoaded(null)
      return
    }
    if (isReactComponent(handle.CardComponent)) {
      cardCache.set(identity, handle.CardComponent)
      cacheOwners.set(identity, handle)
      setLoaded({ owner: handle, generation, component: handle.CardComponent })
      return
    }
    const previous = cacheOwners.get(identity) === handle ? cardCache.get(identity) : undefined
    if (previous) {
      setLoaded({ owner: handle, generation, component: previous })
      return
    }
    cardCache.delete(identity)
    cacheOwners.delete(identity)
    setLoaded(null)
    void loadCard(identity, handle, generation).then((component) => {
      if (alive && isCurrent(identity, handle, generation)) setLoaded({ owner: handle, generation, component: component ?? undefined })
    }).catch((error) => {
      console.warn('[PluginHostCard] load failed', error)
      if (alive && isCurrent(identity, handle, generation)) setLoaded({ owner: handle, generation, failed: true })
    })
    return () => { alive = false }
  }, [identity, handle, generation])

  const fallback = (message: string, failed = false) => <SdkToastCard
    title={event.title || 'Plugin'} body={event.body || message} level={failed ? 'error' : event.level || 'warning'}
    isHovered={isHovered} sticky={!!event.sticky} progress={event.progress ?? null} actions={event.actions || []}
    onClose={onClose} onAction={onAction}
  />
  if (!isEnabled(handle)) return fallback('No custom card UI for this plugin event.')
  const result = loaded?.owner === handle && loaded.generation === generation ? loaded : null
  const Card = registered || cached || result?.component
  if (!Card) return fallback(result?.failed ? 'Failed to load plugin card UI.' : 'Loading plugin card UI…', result?.failed)
  const cardProps: PluginCardProps = { event, isHovered, remainingMs: remainingMs ?? 0, totalMs: totalMs ?? 0, onClose, onAction }
  return <PluginCardBoundary key={`${identity}@g${generation}`} card={Card} cardProps={cardProps} fallback={fallback('Failed to render plugin card UI.', true)} />
}
