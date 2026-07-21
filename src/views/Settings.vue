<script setup lang="ts">
import { computed, ref, onMounted, nextTick, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { load, type Store } from '@tauri-apps/plugin-store'
import Sortable from 'sortablejs'
import MediaSettingsCard from '../components/settings/MediaSettingsCard.vue'
import SystemSettingsCard from '../components/settings/SystemSettingsCard.vue'
import LinksSettingsCard from '../components/settings/LinksSettingsCard.vue'
import SignalSettingsCard from '../components/settings/SignalSettingsCard.vue'
import { usePluginRegistry } from '../stores/pluginRegistry'

const { t } = useI18n()
const message = useMessage()
const pluginRegistry = usePluginRegistry()

/** Built-in system cards (not product plugins). */
const CORE_GROUP_KEYS = ['media', 'signal', 'system', 'links'] as const
type CoreGroupKey = (typeof CORE_GROUP_KEYS)[number]

const coreCardComponents: Record<CoreGroupKey, Component> = {
  media: MediaSettingsCard,
  signal: SignalSettingsCard,
  system: SystemSettingsCard,
  links: LinksSettingsCard,
}

interface SettingsCardSlot {
  key: string
  component: Component
  source: 'core' | 'plugin'
}

const pluginSettingsCards = computed<SettingsCardSlot[]>(() =>
  pluginRegistry.getSettingsPlugins('settings').map((p) => ({
    key: p.settingsKey || p.manifest.name,
    component: p.SettingsComponent as Component,
    source: 'plugin' as const,
  })),
)

const defaultGroupOrder = computed(() => {
  const pluginKeys = pluginSettingsCards.value.map((c) => c.key)
  // Future settings-surface plugins insert at the front of the grid
  const insertAt = 0
  const core = [...CORE_GROUP_KEYS]
  return [...core.slice(0, insertAt), ...pluginKeys, ...core.slice(insertAt)]
})

const groupOrder = ref<string[]>([])

const cardByKey = computed(() => {
  const map = new Map<string, SettingsCardSlot>()
  for (const k of CORE_GROUP_KEYS) {
    map.set(k, { key: k, component: coreCardComponents[k], source: 'core' })
  }
  for (const p of pluginSettingsCards.value) {
    map.set(p.key, p)
  }
  return map
})

const orderedCards = computed(() => {
  const map = cardByKey.value
  return groupOrder.value
    .map((k) => map.get(k))
    .filter((c): c is SettingsCardSlot => !!c)
})

let settingsStore: Store | null = null
let sortable: Sortable | null = null

async function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return settingsStore
}

function normalizeGroupOrder(saved: unknown): string[] {
  const allowed = new Set(defaultGroupOrder.value)
  const out: string[] = []
  if (Array.isArray(saved)) {
    for (const k of saved) {
      if (typeof k === 'string' && allowed.has(k) && !out.includes(k)) {
        out.push(k)
      }
    }
  }
  for (const k of defaultGroupOrder.value) {
    if (!out.includes(k)) out.push(k)
  }
  return out
}

async function loadGroupOrder() {
  try {
    const store = await getSettingsStore()
    const saved = await store.get('settings_group_order')
    const normalized = normalizeGroupOrder(saved)
    groupOrder.value = normalized
    // Persist migration when keys were filtered/added (e.g. settings-surface plugins)
    if (JSON.stringify(saved) !== JSON.stringify(normalized)) {
      await store.set('settings_group_order', normalized)
    }
  } catch (e) {
    console.error('Failed to load settings group order', e)
    groupOrder.value = [...defaultGroupOrder.value]
  }
}

async function saveGroupOrder() {
  try {
    const store = await getSettingsStore()
    await store.set('settings_group_order', groupOrder.value)
  } catch (e) {
    console.error('Failed to save settings group order', e)
    message.error(t('settings.messages.saveFailed'))
  }
}

function initSortable() {
  const grid = document.querySelector('.settings-grid')
  if (!grid || sortable) return
  const allowed = () => new Set(defaultGroupOrder.value)
  sortable = Sortable.create(grid as HTMLElement, {
    forceFallback: true,
    animation: 200,
    ghostClass: 'dragging',
    dragClass: 'drag-over',
    handle: '.drag-handle',
    filter:
      '.n-slider, .n-switch, .n-button, .n-select, .n-input, .link-item, .fs-btn, input, textarea, select, button, a',
    preventOnFilter: false,
    onEnd: () => {
      const keys = Array.from(grid.children)
        .map((child) => child.getAttribute('data-group-key'))
        .filter((k): k is string => !!k && allowed().has(k))
      if (keys.length === allowed().size) {
        groupOrder.value = keys
        saveGroupOrder()
      }
    },
  })
}

onMounted(async () => {
  await loadGroupOrder()
  await nextTick()
  initSortable()
})
</script>

<template>
  <div class="settings">
    <h1 class="title">{{ t('settings.title') }}</h1>
    <p class="subtitle">{{ t('settings.subtitle') }}</p>

    <div class="settings-grid">
      <div
        v-for="card in orderedCards"
        :key="card.key"
        class="settings-card-wrapper"
        :data-group-key="card.key"
        :data-card-source="card.source"
      >
        <KeepAlive>
          <component :is="card.component" />
        </KeepAlive>
        <div class="drag-handle" :aria-label="t('settings.dragHandle')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="5" r="2" />
            <circle cx="12" cy="5" r="2" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 1.25rem;
}

.title {
  font-size: 1.375rem;
  font-weight: 700;
  color: #2e1065;
  margin: 0 0 0.35rem 0;
}

.subtitle {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
  color: #8b7aab;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(23.75rem, 1fr));
  gap: 0.75rem;
}

:deep(.group) {
  position: relative;
  background: #fff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.875rem;
  padding: 1rem 1.25rem;
  box-sizing: border-box;
  height: 100%;
  transition: opacity 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}

.settings-card-wrapper {
  position: relative;
}

.settings-card-wrapper :deep(.group-label) {
  padding-right: 2rem;
}

.drag-handle {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.625rem;
  border-radius: 0.375rem;
  color: #c4b5fd;
  cursor: grab;
  transition: color 0.15s ease, background-color 0.15s ease;
  z-index: 10;
}

.drag-handle:hover {
  color: #7c3aed;
  background: #f5f3ff;
}

.drag-handle:active {
  cursor: grabbing;
}

.settings-card-wrapper.dragging {
  opacity: 0.35;
  pointer-events: none;
}

.settings-card-wrapper.dragging :deep(.group) {
  background: #f5f3ff;
  border-style: dashed;
}

.settings-card-wrapper.drag-over {
  opacity: 0.95;
  transform: scale(1.02) rotate(1deg);
  box-shadow: 0 0.75rem 2rem rgba(124, 58, 237, 0.2);
  z-index: 1000;
  transition: none !important;
}

:deep(.group-label) {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #8b7aab;
  text-transform: uppercase;
  letter-spacing: 0.0312rem;
  margin-bottom: 0;
}

:deep(.divider) {
  height: 0.0625rem;
  background: #f5f3ff;
  margin: 0;
}

@media (max-width: 56.25rem) {
  .settings {
    padding: 1.25rem;
  }
}
</style>
