<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  h,
  markRaw,
  shallowRef,
  watch,
  type Component,
} from 'vue'
import type { BusEvent } from '../types/event'
import { usePluginRegistry } from '../stores/pluginRegistry'
import { getPluginUiSource } from '../api/tauri'
import SdkToastCard from './SdkToastCard.vue'

const props = defineProps<{
  event: BusEvent
  isHovered?: boolean
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

function ensurePluginVueRuntime() {
  const g = globalThis as typeof globalThis & {
    __CATRACE_VUE__?: Record<string, unknown>
  }
  if (!g.__CATRACE_VUE__) {
    g.__CATRACE_VUE__ = { h, markRaw }
  }
}

async function loadFromBlobUrl(url: string): Promise<Component> {
  const mod: Record<string, unknown> = await import(/* @vite-ignore */ url)
  const comp = (mod.default || mod.Card || mod.card) as Component | undefined
  if (!comp) throw new Error('plugin UI module has no default/Card export')
  return markRaw(comp as object) as Component
}

async function loadFromPluginId(id: string): Promise<Component> {
  ensurePluginVueRuntime()
  const source = await getPluginUiSource(id)
  const blob = new Blob([source], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  return loadFromBlobUrl(blobUrl)
}

function resolveCard(): Component {
  const registered =
    registry.getCardComponent(props.event.kind) ||
    registry.getCardComponent(props.event.event_type)
  if (registered) return markRaw(registered)

  const url = props.uiUrl
  const pid =
    props.pluginId ||
    (props.event.source &&
    typeof props.event.source === 'object' &&
    (props.event.source as { type?: string; name?: string }).type === 'plugin'
      ? (props.event.source as { name: string }).name
      : undefined)

  if (url || pid) {
    return markRaw(
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
  }

  return FallbackCard
}

const cardComp = shallowRef<Component>(resolveCard())
const cardKey = computed(
  () =>
    `${props.event.kind}|${props.uiUrl || ''}|${props.pluginId || ''}|${
      registry.getPluginForKind(props.event.kind)?.manifest.name || ''
    }`,
)

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
    @close="emit('close')"
    @action="(id: string) => emit('action', id)"
  />
</template>
