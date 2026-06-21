<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { load, type Store } from '@tauri-apps/plugin-store'
import Sortable from 'sortablejs'
import ReminderSettingsCard from '../components/settings/ReminderSettingsCard.vue'
import SystemSettingsCard from '../components/settings/SystemSettingsCard.vue'
import NotificationSettingsCard from '../components/settings/NotificationSettingsCard.vue'
import LinksSettingsCard from '../components/settings/LinksSettingsCard.vue'
import WaterSettingsCard from '../components/settings/WaterSettingsCard.vue'

const { t } = useI18n()
const message = useMessage()

const GROUP_KEYS = ['reminder', 'system', 'notification', 'links', 'water'] as const
type GroupKey = typeof GROUP_KEYS[number]
const defaultGroupOrder: GroupKey[] = ['reminder', 'system', 'notification', 'links', 'water']
const groupOrder = ref<GroupKey[]>([...defaultGroupOrder])

const cardComponents: Record<GroupKey, typeof ReminderSettingsCard> = {
  reminder: ReminderSettingsCard,
  system: SystemSettingsCard,
  notification: NotificationSettingsCard,
  links: LinksSettingsCard,
  water: WaterSettingsCard,
}

let settingsStore: Store | null = null
let sortable: Sortable | null = null

async function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return settingsStore
}

async function loadGroupOrder() {
  try {
    const store = await getSettingsStore()
    const saved = await store.get<GroupKey[]>('settings_group_order')
    if (saved && saved.length === GROUP_KEYS.length && saved.every(k => GROUP_KEYS.includes(k))) {
      groupOrder.value = saved
    }
  } catch (e) {
    console.error('Failed to load settings group order', e)
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
  sortable = Sortable.create(grid as HTMLElement, {
    forceFallback: true,
    animation: 200,
    ghostClass: 'dragging',
    dragClass: 'drag-over',
    fallbackClass: 'sortable-fallback',
    handle: '.group',
    filter: '.n-slider, .n-switch, .n-button, .n-select, .n-input, .n-base-selection, .n-base-select-menu, .link-item, .fs-btn, .water-test-btn, .video-rules-link, input, textarea, select, button, a',
    preventOnFilter: false,
    onEnd: () => {
      const keys = Array.from(grid.children)
        .map(child => child.getAttribute('data-group-key') as GroupKey | null)
        .filter((k): k is GroupKey => !!k && GROUP_KEYS.includes(k))
      if (keys.length === GROUP_KEYS.length) {
        groupOrder.value = keys
        saveGroupOrder()
        nextTick(() => {
          sortable?.destroy()
          sortable = null
          initSortable()
        })
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

    <div class="settings-grid">
      <KeepAlive>
        <component
          :is="cardComponents[key]"
          v-for="key in groupOrder"
          :key="key"
          :data-group-key="key"
        />
      </KeepAlive>
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
  color: #2E1065;
  margin: 0 0 1rem 0;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(23.75rem, 1fr));
  gap: 0.75rem;
}

:deep(.group) {
  position: relative;
  background: #fff;
  border: 0.0625rem solid #EBE6F2;
  border-radius: 0.875rem;
  padding: 1rem 1.25rem;
  box-sizing: border-box;
  cursor: grab;
  transition: opacity 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}

:deep(.group):active {
  cursor: grabbing;
}

:deep(.group.dragging) {
  opacity: 0.35;
  background: #F5F3FF;
  border-style: dashed;
  pointer-events: none;
}

:deep(.group.drag-over) {
  opacity: 0.95;
  transform: scale(1.02) rotate(1deg);
  box-shadow: 0 0.75rem 2rem rgba(124, 58, 237, 0.2);
  z-index: 1000;
  transition: none !important;
}

:deep(.group-label) {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #8B7AAB;
  text-transform: uppercase;
  letter-spacing: 0.0312rem;
  margin-bottom: 0;
}

:deep(.divider) {
  height: 0.0625rem;
  background: #F5F3FF;
  margin: 0;
}

@media (max-width: 56.25rem) {
  .settings {
    padding: 1.25rem;
  }
}
</style>
