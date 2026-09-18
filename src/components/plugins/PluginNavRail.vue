<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlarmClock,
  Archive,
  Armchair,
  ChevronDown,
  Clock,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
} from '@lucide/vue'
import PageScroll from '../PageScroll.vue'

export interface PluginNavItem {
  id: string
  name: string
  subtitle: string
  external: boolean
  enabled: boolean
  registered: boolean
  error: string | null
  anomalous: boolean
  version?: string
  /** Base64 data URL from the plugin's manifest icon (external plugins). */
  icon?: string | null
  tone: string
}

interface Props {
  items: PluginNavItem[]
  selectedId: string
  loading?: boolean
  searchQuery?: string
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  searchQuery: '',
})

const emit = defineEmits<{
  'update:selectedId': [id: string]
  'update:searchQuery': [value: string]
  refresh: []
  openDir: []
  installFolder: []
  installZip: []
}>()

const { t } = useI18n()
const installMenuOpen = ref(false)
const installMenuRoot = ref<HTMLElement | null>(null)

const query = computed({
  get: () => props.searchQuery,
  set: (value: string) => emit('update:searchQuery', value),
})

const filteredItems = computed(() => {
  const q = query.value.trim().toLocaleLowerCase()
  if (!q) return props.items
  return props.items.filter((item) =>
    [item.name, item.subtitle, item.id].some((value) =>
      value.toLocaleLowerCase().includes(q),
    ),
  )
})

function iconForPlugin(id: string) {
  if (id === 'rest') return Armchair
  if (id === 'timer') return Clock
  return AlarmClock
}

function select(id: string) {
  installMenuOpen.value = false
  emit('update:selectedId', id)
}

function refresh() {
  installMenuOpen.value = false
  emit('refresh')
}

function openDir() {
  installMenuOpen.value = false
  emit('openDir')
}

function toggleInstallMenu() {
  if (props.loading) return
  installMenuOpen.value = !installMenuOpen.value
}

function installFolder() {
  installMenuOpen.value = false
  emit('installFolder')
}

function installZip() {
  installMenuOpen.value = false
  emit('installZip')
}

function onDocPointerDown(event: PointerEvent) {
  const root = installMenuRoot.value
  if (!root || !installMenuOpen.value) return
  if (event.target instanceof Node && !root.contains(event.target)) {
    installMenuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <aside class="plugin-rail" :aria-label="t('plugins.listHeading')">
    <div class="rail-header">
      <div class="rail-heading">
        <h1 class="rail-title">{{ t('plugins.centerTitle') }}</h1>
        <span class="plugin-count">{{ items.length }}</span>
      </div>
      <button
        type="button"
        class="icon-btn"
        :title="t('plugins.external.refresh')"
        :disabled="loading"
        @click="refresh"
      >
        <RefreshCw
          :size="16"
          :stroke-width="2"
          :class="{ spin: loading }"
          aria-hidden="true"
        />
      </button>
    </div>

    <div class="rail-install">
      <div ref="installMenuRoot" class="install-menu">
        <button
          type="button"
          class="install-btn"
          :aria-expanded="installMenuOpen"
          aria-haspopup="menu"
          :disabled="loading"
          @click="toggleInstallMenu"
        >
          <span class="install-btn-left">
            <Plus :size="15" :stroke-width="2.25" aria-hidden="true" />
            <span>{{ t('plugins.external.install') }}</span>
          </span>
          <ChevronDown
            class="install-chevron"
            :class="{ open: installMenuOpen }"
            :size="15"
            :stroke-width="2"
            aria-hidden="true"
          />
        </button>
        <div
          v-if="installMenuOpen"
          class="install-dropdown"
          role="menu"
          :aria-label="t('plugins.external.install')"
        >
          <button type="button" class="install-option" role="menuitem" @click="installZip">
            <span class="option-icon tone-zip" aria-hidden="true">
              <Archive :size="16" :stroke-width="1.7" />
            </span>
            <span class="option-title">{{ t('plugins.external.installZip') }}</span>
          </button>
          <button type="button" class="install-option" role="menuitem" @click="installFolder">
            <span class="option-icon tone-folder" aria-hidden="true">
              <FolderOpen :size="16" :stroke-width="1.7" />
            </span>
            <span class="option-title">{{ t('plugins.external.installFolder') }}</span>
          </button>
          <div class="install-divider" role="separator" />
          <button type="button" class="install-option" role="menuitem" @click="openDir">
            <span class="option-icon tone-dir" aria-hidden="true">
              <FolderOpen :size="16" :stroke-width="1.7" />
            </span>
            <span class="option-title">{{ t('plugins.external.openDir') }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="rail-search">
      <label class="search-field">
        <Search :size="15" :stroke-width="2" aria-hidden="true" />
        <input
          v-model="query"
          type="search"
          :placeholder="t('plugins.searchPlaceholder')"
        />
      </label>
    </div>

    <page-scroll class="rail-list">
      <div class="rail-list-content">
          <button
            v-for="p in filteredItems"
            :key="p.id"
            type="button"
            class="plugin-item"
            :class="[`tone-${p.tone}`, { active: selectedId === p.id, disabled: !!p.error }]"
            :aria-current="selectedId === p.id ? 'page' : undefined"
            @click="select(p.id)"
          >
            <div class="item-icon" aria-hidden="true">
              <img v-if="p.icon" :src="p.icon" alt="" class="item-icon-img" />
              <component
                v-else
                :is="iconForPlugin(p.id)"
                :size="18"
                :stroke-width="2"
                class="item-icon-lucide"
                aria-hidden="true"
              />
            </div>
            <div class="item-text">
              <div class="item-name">
                <span class="item-name-text">{{ p.name }}</span>
              </div>
              <div
                v-if="(p.external && p.version) || p.anomalous"
                class="item-meta"
              >
                <span v-if="p.external && p.version" class="ver">v{{ p.version }}</span>
                <span v-if="p.anomalous" class="anomaly-tag">{{ t('plugins.external.anomalous') }}</span>
              </div>
              <div class="item-sub">{{ p.subtitle }}</div>
            </div>
            <span
              class="status-dot"
              :class="{
                enabled: p.enabled && !p.error && p.registered,
                error: !!p.error,
              }"
              aria-hidden="true"
            />
          </button>

          <p v-if="!filteredItems.length" class="list-hint">
            {{ t('plugins.searchEmpty') }}
          </p>
      </div>
    </page-scroll>
  </aside>
</template>

<style scoped>
.plugin-rail {
  min-height: 0;
  flex: 0 0 15rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ct-surface);
  border-right: 0.0625rem solid var(--ct-border);
}

.rail-header {
  padding: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.rail-heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.rail-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.plugin-count {
  min-width: 1.25rem;
  padding: 0.125rem 0.35rem;
  border-radius: 999px;
  background: var(--ct-surface-2);
  color: var(--ct-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.625rem;
  line-height: 1rem;
  text-align: center;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  border: none;
  background: transparent;
  color: var(--ct-text-subtle);
  border-radius: 0.5rem;
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  background: var(--ct-surface-2);
  color: var(--ct-text-muted);
}

.icon-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.icon-btn .spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.rail-search {
  flex: none;
  padding: 0.5rem;
  padding-top: 0;
  border-bottom: 0.0625rem solid var(--ct-surface-2);
}

.rail-install {
  flex: none;
  padding: 0 0.5rem 0.5rem;
}

.install-menu {
  position: relative;
}

.install-btn {
  width: 100%;
  height: 2.25rem;
  padding: 0 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border: none;
  border-radius: 0.625rem;
  background: var(--ct-accent);
  color: var(--ct-on-accent);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 0.125rem 0.375rem rgba(124, 58, 237, 0.22);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.install-btn:hover:not(:disabled) {
  background: var(--ct-accent-hover);
  box-shadow: 0 0.1875rem 0.5rem rgba(124, 58, 237, 0.28);
}

.install-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.install-btn-left {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.install-chevron {
  opacity: 0.9;
  transition: transform 0.15s ease;
}

.install-chevron.open {
  transform: rotate(180deg);
}

.install-dropdown {
  position: absolute;
  top: calc(100% + 0.375rem);
  left: 0;
  right: 0;
  z-index: 30;
  padding: 0.375rem;
  border: 0.0625rem solid var(--ct-border);
  border-radius: 0.75rem;
  background: var(--ct-surface);
  box-shadow:
    0 0.5rem 1.25rem rgba(15, 23, 42, 0.1),
    0 0.0625rem 0.125rem rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.install-option {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  min-height: 2.375rem;
  margin: 0;
  padding: 0.5rem 0.625rem;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}

.install-option:hover {
  background: var(--ct-bg);
}

.install-divider {
  height: 0.0625rem;
  margin: 0.25rem 0.375rem;
  background: var(--ct-border);
}

.option-icon {
  width: 1.25rem;
  height: 1.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.option-icon.tone-zip {
  color: var(--ct-accent);
}

.option-icon.tone-folder {
  color: var(--ct-warning);
}

.option-icon.tone-dir {
  color: var(--ct-text-subtle);
}

.option-title {
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.3;
  color: var(--ct-text-muted);
}

.search-field {
  height: 2rem;
  padding: 0 0.625rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 0.0625rem solid var(--ct-border);
  border-radius: 0.5rem;
  background: var(--ct-bg);
  color: var(--ct-text-subtle);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.search-field:focus-within {
  border-color: var(--ct-accent-border);
  box-shadow: 0 0 0 0.125rem var(--ct-accent-soft);
  background: var(--ct-surface);
}

.search-field input {
  width: 100%;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ct-text-muted);
  font: inherit;
  font-size: 0.75rem;
}

.search-field input::placeholder {
  color: var(--ct-text-subtle);
}

.search-field input::-webkit-search-cancel-button {
  display: none;
}

.rail-list {
  flex: 1;
}

.rail-list-content {
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.list-hint {
  margin: 1rem 0.5rem;
  font-size: 0.75rem;
  color: var(--ct-text-subtle);
  line-height: 1.4;
  text-align: center;
}

.plugin-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  text-align: left;
  border: 0.0625rem solid transparent;
  background: transparent;
  border-radius: 0.625rem;
  padding: 0.625rem;
  cursor: pointer;
  color: var(--ct-text-muted);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.plugin-item:hover {
  background: var(--ct-bg);
}

.plugin-item:focus-visible,
.icon-btn:focus-visible,
.install-btn:focus-visible {
  outline: 0.125rem solid var(--ct-accent);
  outline-offset: 0.125rem;
}

.plugin-item.active {
  background: var(--ct-accent-softer);
  border-color: var(--ct-accent-soft);
  color: var(--ct-accent-strong);
}

.plugin-item.disabled .item-name {
  color: var(--ct-text-subtle);
}

.item-icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

/* plugin-provided icon: fill the badge, light neutral backdrop */
.item-icon-img {
  width: 100%;
  height: 100%;
  border-radius: 0.625rem;
  object-fit: cover;
  background: var(--ct-surface-2);
}

/* active selected: match the white badge; custom icons show as-is */
.plugin-item.active .item-icon-img {
  background: var(--ct-surface);
}

/* per-plugin tones (idle) */
.tone-rest .item-icon {
  background: var(--ct-warning-soft);
  color: var(--ct-warning);
}
.tone-timer .item-icon {
  background: var(--ct-accent-soft);
  color: var(--ct-accent);
}
.tone-agent .item-icon {
  background: var(--ct-info-soft);
  color: var(--ct-info);
}
.tone-external .item-icon {
  background: var(--ct-success-soft);
  color: var(--ct-success);
}

/* active selected: white badge with a violet ring — icon keeps its own color */
.plugin-item.active .item-icon {
  background: var(--ct-surface);
  box-shadow: 0 0 0 0.125rem var(--ct-accent-soft);
}

/* keep per-plugin stroke color on the lucide fallback even when selected */
.plugin-item .item-icon-lucide {
  color: inherit;
}
.plugin-item.active .item-icon-lucide {
  color: var(--ct-accent-hover);
}

.plugin-item.active .item-name {
  font-weight: 700;
  color: var(--ct-accent-hover);
}

.plugin-item.active .item-sub {
  color: var(--ct-accent);
}

.item-text {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ct-text);
  line-height: 1.3;
  min-width: 0;
}

.item-name-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: nowrap;
  min-width: 0;
  margin-top: 0.15rem;
}

.item-meta .ver,
.item-meta .anomaly-tag {
  flex-shrink: 0;
}

.ver {
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--ct-text-subtle);
  background: var(--ct-surface-2);
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
}

.anomaly-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.0625rem 0.375rem;
  border: 1px solid var(--ct-warning-soft);
  border-radius: 999px;
  background: var(--ct-warning-soft);
  color: var(--ct-warning-strong);
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1.25rem;
}

.anomaly-tag-lg {
  padding-inline: 0.5rem;
  font-size: 0.6875rem;
}

.item-sub {
  margin-top: 0.15rem;
  font-size: 0.6875rem;
  color: var(--ct-text-subtle);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  flex: none;
  border-radius: 50%;
  background: var(--ct-border);
  box-shadow: 0 0 0 0.125rem var(--ct-surface-2);
}

.status-dot.enabled {
  background: var(--ct-success);
  box-shadow: 0 0 0 0.125rem var(--ct-success-soft);
}

.status-dot.error {
  background: var(--ct-error);
  box-shadow: 0 0 0 0.125rem var(--ct-error-soft);
}
</style>
