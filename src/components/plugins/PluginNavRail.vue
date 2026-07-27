<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
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
}>()

const { t } = useI18n()

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

function select(id: string) {
  emit('update:selectedId', id)
}

function refresh() {
  emit('refresh')
}

function openDir() {
  emit('openDir')
}
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
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :class="{ spin: loading }"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>
    </div>

    <div class="rail-search">
      <label class="search-field">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
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
              <svg v-if="p.id === 'rest'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
                <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0z" />
                <path d="M5 18v2" />
                <path d="M19 18v2" />
              </svg>
              <svg v-else-if="p.id === 'timer'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <svg v-else-if="p.id === 'agent'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2 2" />
                <path d="M5 3 2 6" />
                <path d="m22 6-3-3" />
                <path d="M6.38 18.7 4 21" />
                <path d="M17.64 18.67 20 21" />
              </svg>
            </div>
            <div class="item-text">
              <div class="item-name">
                {{ p.name }}
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

          <div v-if="!query" class="explore-wrap">
            <button
              type="button"
              class="explore-btn"
              :title="t('plugins.external.openDir')"
              @click="openDir"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v8" />
                <path d="M8 12h8" />
              </svg>
              {{ t('plugins.exploreMore') }}
            </button>
          </div>
      </div>
    </page-scroll>
  </aside>
</template>

<style scoped>
.plugin-rail {
  width: 15rem;
  min-width: 15rem;
  height: 100%;
  min-height: 0;
  flex: 0 0 15rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border-right: 0.0625rem solid #e2e8f0;
}

.rail-header {
  padding: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 0.0625rem solid #f1f5f9;
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
  background: #f1f5f9;
  color: #64748b;
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
  color: #94a3b8;
  border-radius: 0.5rem;
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  background: #f1f5f9;
  color: #475569;
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
  border-bottom: 0.0625rem solid #f1f5f9;
}

.search-field {
  height: 2rem;
  padding: 0 0.625rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.5rem;
  background: #f8fafc;
  color: #94a3b8;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.search-field:focus-within {
  border-color: #c4b5fd;
  box-shadow: 0 0 0 0.125rem #ede9fe;
  background: #fff;
}

.search-field input {
  width: 100%;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: #334155;
  font: inherit;
  font-size: 0.75rem;
}

.search-field input::placeholder {
  color: #94a3b8;
}

.search-field input::-webkit-search-cancel-button {
  display: none;
}

.rail-list {
  flex: 1;
  min-height: 0;
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
  color: #94a3b8;
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
  color: #334155;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.plugin-item:hover {
  background: #f8fafc;
}

.plugin-item:focus-visible,
.explore-btn:focus-visible {
  outline: 0.125rem solid #7c3aed;
  outline-offset: 0.125rem;
}

.plugin-item.active {
  background: #f5f3ff;
  border-color: #ede9fe;
  color: #1e1b4b;
}

.plugin-item.disabled .item-name {
  color: #9ca3af;
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

/* per-plugin tones (idle) */
.tone-rest .item-icon {
  background: #fef3c7;
  color: #d97706;
}
.tone-timer .item-icon {
  background: #ede9fe;
  color: #7c3aed;
}
.tone-agent .item-icon {
  background: #dbeafe;
  color: #2563eb;
}
.tone-external .item-icon {
  background: #d1fae5;
  color: #059669;
}

/* active selected: solid brand icon */
.plugin-item.active .item-icon {
  background: #7c3aed;
  color: #fff;
  box-shadow: 0 0.0625rem 0.25rem rgba(124, 58, 237, 0.25);
}

.plugin-item.active .item-name {
  font-weight: 700;
  color: #6d28d9;
}

.plugin-item.active .item-sub {
  color: #8b5cf6;
}

.item-text {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.3;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.ver {
  font-size: 0.625rem;
  font-weight: 500;
  color: #64748b;
  background: #f1f5f9;
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
}

.anomaly-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.0625rem 0.375rem;
  border: 1px solid #fed7aa;
  border-radius: 999px;
  background: #fff7ed;
  color: #c2410c;
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
  color: #94a3b8;
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
  background: #cbd5e1;
  box-shadow: 0 0 0 0.125rem #f1f5f9;
}

.status-dot.enabled {
  background: #22c55e;
  box-shadow: 0 0 0 0.125rem #dcfce7;
}

.status-dot.error {
  background: #ef4444;
  box-shadow: 0 0 0 0.125rem #fee2e2;
}

.explore-wrap {
  padding-top: 0.25rem;
}

.explore-btn {
  width: 100%;
  height: 2.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 0.0625rem dashed #cbd5e1;
  border-radius: 0.625rem;
  background: transparent;
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
}

.explore-btn:hover {
  border-color: #a78bfa;
  background: #faf5ff;
  color: #7c3aed;
}

@media (max-width: 56.25rem) {
  .plugin-rail {
    width: 15rem;
    min-width: 15rem;
    flex-basis: 15rem;
  }
}
</style>
