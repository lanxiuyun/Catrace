<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  h,
  markRaw,
  shallowRef,
  onMounted,
  watch,
  type Component,
} from 'vue'
import type { BusEvent } from '../types/event'
import { usePluginRegistry } from '../stores/pluginRegistry'
import { getPluginUiSource } from '../api/tauri'
import SdkToastCard from './SdkToastCard.vue'
import { ensurePluginRuntime } from '../plugins/pluginRuntime'
import { wrapPluginSource } from '../plugins/pluginApi'
import { getPluginHostCardCache } from './pluginHostCardCache'

const props = defineProps<{
  event: BusEvent
  isHovered?: boolean
  /** Host toast remaining lifetime (ms) — drives plugin progress bars. */
  remainingMs?: number
  /** Host toast total lifetime (ms). */
  totalMs?: number
  /** Blob/asset URL when registry already prepared one. */
  uiUrl?: string | null
  /** Plugin id — used to fetch source if Card not in registry yet. */
  pluginId?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'action', actionId: string): void
}>()

const registry = usePluginRegistry()

/** Process-wide: never re-defineAsyncComponent for the same plugin in one toast session. */
const cardCache = getPluginHostCardCache()

function renderSdkFallback(message: string, level: string = 'warning') {
  return h(SdkToastCard, {
    title: props.event.title || 'Plugin',
    body: props.event.body || message,
    level,
    isHovered: props.isHovered,
    sticky: !!props.event.sticky,
    progress: props.event.progress ?? null,
    actions: props.event.actions || [],
    onClose: () => emit('close'),
    onAction: (id: string) => emit('action', id),
  })
}

const FallbackCard = markRaw({
  name: 'PluginCardFallback',
  setup() {
    return () => renderSdkFallback('No custom card UI for this plugin event.')
  },
}) as Component

async function loadFromBlobUrl(url: string): Promise<Component> {
  const mod: Record<string, unknown> = await import(/* @vite-ignore */ url)
  const comp = (mod.default || mod.Card || mod.card) as Component | undefined
  if (!comp) throw new Error('plugin UI module has no default/Card export')
  return markRaw(comp as object) as Component
}

async function loadFromPluginId(id: string): Promise<Component> {
  ensurePluginRuntime()
  const source = await getPluginUiSource(id)
  const blob = new Blob([wrapPluginSource(id, source)], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  return loadFromBlobUrl(blobUrl)
}

function cacheKey(): string {
  const pid =
    props.pluginId ||
    (props.event.source &&
    typeof props.event.source === 'object' &&
    (props.event.source as { type?: string; name?: string }).type === 'plugin'
      ? (props.event.source as { name: string }).name
      : '') ||
    props.event.kind
  return pid || props.event.kind
}

function resolveCard(): Component {
  const key = cacheKey()
  const cached = cardCache.get(key)
  if (cached) {
    console.info('[PluginHostCard] cache hit', { key, eventId: props.event.id, t: Date.now() })
    return cached
  }
  console.info('[PluginHostCard] resolve card', {
    key,
    eventId: props.event.id,
    pluginId: props.pluginId,
    hasUiUrl: !!props.uiUrl,
  })

  const registered =
    registry.getCardComponent(props.event.kind) ||
    registry.getCardComponent(props.event.event_type)
  if (registered) {
    const c = markRaw(registered)
    cardCache.set(key, c)
    return c
  }

  const url = props.uiUrl
  const pid =
    props.pluginId ||
    (props.event.source &&
    typeof props.event.source === 'object' &&
    (props.event.source as { type?: string; name?: string }).type === 'plugin'
      ? (props.event.source as { name: string }).name
      : undefined)

  if (url || pid) {
    const asyncCard = markRaw(
      defineAsyncComponent({
        loader: async () => {
          try {
            if (url) return await loadFromBlobUrl(url)
            return await loadFromPluginId(pid as string)
          } catch (e) {
            console.warn('[PluginHostCard] load failed', e)
            throw e
          }
        },
        delay: 0,
        timeout: 10000,
        errorComponent: markRaw({
          name: 'PluginCardLoadError',
          setup() {
            return () => renderSdkFallback('Failed to load plugin card UI.', 'error')
          },
        }) as Component,
        loadingComponent: markRaw({
          name: 'PluginCardLoading',
          setup() {
            return () =>
              h(SdkToastCard, {
                title: props.event.title || 'Loading…',
                body: props.event.body || '',
                level: props.event.level || 'info',
                isHovered: props.isHovered,
                sticky: true,
              })
          },
        }) as Component,
      }),
    )
    cardCache.set(key, asyncCard)
    return asyncCard
  }

  return FallbackCard
}

function handleCardAction(actionId: string) {
  console.info('[PluginHostCard] action', {
    eventId: props.event.id,
    pluginId: props.pluginId,
    actionId,
    cacheKey: cacheKey(),
    t: Date.now(),
  })
  emit('action', actionId)
}

const cardComp = shallowRef<Component>(resolveCard())

onMounted(() => {
  console.info('[PluginHostCard] mount', {
    eventId: props.event.id,
    pluginId: props.pluginId,
    cacheKey: cacheKey(),
    t: Date.now(),
  })
})
/** Only remount when the plugin identity changes — not on every event revision/id. */
const cardKey = computed(() => cacheKey())

watch(
  cardKey,
  () => {
    cardComp.value = resolveCard()
  },
  { flush: 'sync' },
)
</script>

<template>
  <component
    :is="cardComp"
    :event="event"
    :is-hovered="isHovered"
    :remaining-ms="remainingMs ?? 0"
    :total-ms="totalMs ?? 0"
    @close="emit('close')"
    @action="handleCardAction"
  />
</template>
