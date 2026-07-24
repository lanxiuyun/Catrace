<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { load, type Store } from '@tauri-apps/plugin-store'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useI18n } from 'vue-i18n'
import RestPluginPanel from '../components/plugins/RestPluginPanel.vue'
import TimerPluginPanel from '../components/plugins/TimerPluginPanel.vue'
import AgentPluginPanel from '../components/plugins/AgentPluginPanel.vue'
import OverlayScrollbar from '../components/OverlayScrollbar.vue'
import { usePluginRegistry } from '../stores/pluginRegistry'
import {
  listExternalPlugins,
  setExternalPluginEnabled,
  openPluginsDir,
  publishEvent,
  getTimerSettings,
  getAgentNotificationEnabled,
  type ExternalPluginInfo,
} from '../api/tauri'
import { loadExternalPlugins } from '../plugins/loadExternalPlugins'

const { t } = useI18n()
const pluginRegistry = usePluginRegistry()

const VISIBLE_PLUGIN_IDS = ['rest', 'timer', 'agent'] as const
type VisiblePluginId = (typeof VISIBLE_PLUGIN_IDS)[number]

const selectedId = ref<string>('timer')
const externalList = ref<ExternalPluginInfo[]>([])
const loading = ref(false)
const toggleBusy = ref<string | null>(null)
const testingId = ref<string | null>(null)
const searchQuery = ref('')
const builtinEnabled = ref<Record<VisiblePluginId, boolean>>({
  rest: true,
  timer: false,
  agent: false,
})

let settingsStore: Store | null = null
let unlistenPluginAnomaly: UnlistenFn | null = null
async function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return settingsStore
}

function onBuiltinPluginEnabledChanged() {
  void refreshBuiltinEnabled()
}

async function refreshBuiltinEnabled() {
  try {
    const store = await getSettingsStore()
    const rest = await store.get<boolean>('plugin_rest_ui_enabled')
    builtinEnabled.value.rest = rest ?? true
  } catch {
    builtinEnabled.value.rest = false
  }
  try {
    const timer = await getTimerSettings()
    builtinEnabled.value.timer = timer.enabled
  } catch {
    builtinEnabled.value.timer = false
  }
  try {
    builtinEnabled.value.agent = await getAgentNotificationEnabled()
  } catch {
    builtinEnabled.value.agent = false
  }
}

async function refreshExternal() {
  loading.value = true
  try {
    externalList.value = await listExternalPlugins()
    // force: user clicked refresh / toggled enable — rebuild Card blobs.
    await loadExternalPlugins({ force: true })
  } catch (e) {
    console.warn('[plugins page] refresh failed', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refreshBuiltinEnabled()
  void refreshExternal()
  void listen<string>('catrace:plugin-anomaly', ({ payload: pluginId }) => {
    const plugin = externalList.value.find((item) => item.id === pluginId)
    if (plugin) plugin.anomalous = true
  }).then((unlisten) => {
    unlistenPluginAnomaly = unlisten
  })
  window.addEventListener('catrace:plugin-enabled-changed', onBuiltinPluginEnabledChanged)
})

onBeforeUnmount(() => {
  unlistenPluginAnomaly?.()
  window.removeEventListener('catrace:plugin-enabled-changed', onBuiltinPluginEnabledChanged)
})

const plugins = computed(() => {
  const builtins = VISIBLE_PLUGIN_IDS.map((id) => {
    const handle = pluginRegistry.getPlugin(id)
    return {
      id,
      name: t(`plugins.${id}.name`),
      subtitle: t(`plugins.${id}.listSubtitle`),
      badge: t(`plugins.${id}.badge`),
      registered: !!handle,
      external: false as const,
      enabled: builtinEnabled.value[id],
      version: handle?.manifest.version,
      error: null as string | null,
      anomalous: false,
      tone: id as string,
    }
  })
  const externals = externalList.value.map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: p.error
      ? p.error
      : p.description || t('plugins.external.localPackage'),
    badge: t('plugins.external.badge'),
    registered: !p.error,
    external: true as const,
    enabled: p.enabled,
    version: p.version,
    error: p.error ?? null,
    anomalous: p.anomalous,
    tone: 'external',
  }))
  return [...builtins, ...externals].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
})

const filteredPlugins = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query) return plugins.value

  return plugins.value.filter((plugin) =>
    [plugin.name, plugin.subtitle, plugin.id].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  )
})

const fallbackDetail: Record<VisiblePluginId, Component> = {
  rest: RestPluginPanel,
  timer: TimerPluginPanel,
  agent: AgentPluginPanel,
}

const selectedExternal = computed(() =>
  externalList.value.find((p) => p.id === selectedId.value) ?? null,
)

const isBuiltinSelected = computed(() =>
  (VISIBLE_PLUGIN_IDS as readonly string[]).includes(selectedId.value),
)

const ActiveDetail = computed(() => {
  if (!isBuiltinSelected.value) return null
  const id = selectedId.value as VisiblePluginId
  const handle = pluginRegistry.getPlugin(id)
  if (handle?.SettingsComponent) return handle.SettingsComponent
  return fallbackDetail[id]
})

async function onToggleExternal(id: string, enabled: boolean) {
  toggleBusy.value = id
  try {
    const updated = await setExternalPluginEnabled(id, enabled)
    externalList.value = externalList.value.map((p) =>
      p.id === id ? updated : p,
    )
    await loadExternalPlugins()
  } catch (e) {
    console.warn('[plugins page] toggle failed', e)
    await refreshExternal()
  } finally {
    toggleBusy.value = null
  }
}

async function onOpenDir() {
  try {
    await openPluginsDir()
  } catch (e) {
    console.warn('[plugins page] open dir failed', e)
  }
}

async function onTestExternal(p: ExternalPluginInfo) {
  if (!p.enabled || p.error || testingId.value) return
  testingId.value = p.id
  try {
    // Do NOT call loadExternalPlugins here: toast window has its own Pinia and already
    // loads on mount. Re-scanning + revoking Blob URLs under a live card freezes the
    // toast WebView; publish alone is enough (same path as rest test + bus).
    await publishEvent({
      id: '',
      event_type: `${p.id}.tick`,
      kind: p.id,
      source: { type: 'plugin', name: p.id },
      display_mode: 'toast',
      title: p.name,
      body: t('plugins.external.testBody'),
      level: 'success',
      sticky: false,
      progress: { current: 3, total: 10, label: '3 / 10' },
      actions: [
        { id: 'snooze', label: t('plugins.external.testSnooze') },
        { id: 'done', label: t('plugins.external.testDone') },
      ],
      payload: {},
      dedupe_key: `${p.id}.test`,
    })
    // Same 1s throttle as RestPluginPanel — avoid hammering ensure_toast + resize.
    await new Promise<void>((r) => setTimeout(r, 1000))
  } catch (e) {
    console.warn('[plugins page] test publish failed', e)
  } finally {
    testingId.value = null
  }
}
</script>

<template>
  <div class="plugins-page">
    <!-- 二级插件导航 -->
    <aside class="plugin-rail" :aria-label="t('plugins.listHeading')">
      <div class="rail-header">
        <div class="rail-heading">
          <h1 class="rail-title">{{ t('plugins.centerTitle') }}</h1>
          <span class="plugin-count">{{ plugins.length }}</span>
        </div>
        <button
          type="button"
          class="icon-btn"
          :title="t('plugins.external.refresh')"
          :disabled="loading"
          @click="refreshExternal"
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
            v-model="searchQuery"
            type="search"
            :placeholder="t('plugins.searchPlaceholder')"
          />
        </label>
      </div>

      <div class="rail-list">
        <OverlayScrollbar>
          <div class="rail-list-content">
            <button
              v-for="p in filteredPlugins"
              :key="p.id"
              type="button"
              class="plugin-item"
              :class="[`tone-${p.tone}`, { active: selectedId === p.id, disabled: !!p.error }]"
              :aria-current="selectedId === p.id ? 'page' : undefined"
              @click="selectedId = p.id"
            >
              <div class="item-icon" aria-hidden="true">
                <!-- rest: armchair -->
                <svg v-if="p.id === 'rest'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
                  <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0z" />
                  <path d="M5 18v2" />
                  <path d="M19 18v2" />
                </svg>
                <!-- timer: clock -->
                <svg v-else-if="p.id === 'timer'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <!-- agent: bot -->
                <svg v-else-if="p.id === 'agent'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" />
                  <path d="M20 14h2" />
                  <path d="M15 13v2" />
                  <path d="M9 13v2" />
                </svg>
                <!-- external: timer -->
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

            <p v-if="!filteredPlugins.length" class="list-hint">
              {{ t('plugins.searchEmpty') }}
            </p>

            <div v-if="!searchQuery" class="explore-wrap">
              <button
                type="button"
                class="explore-btn"
                :title="t('plugins.external.openDir')"
                @click="onOpenDir"
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
        </OverlayScrollbar>
      </div>
    </aside>

    <!-- 主内容 -->
    <main class="plugin-main">
      <component v-if="ActiveDetail" :is="ActiveDetail" :key="selectedId" />

      <div v-else-if="selectedExternal" class="external-detail">
        <header class="ext-header">
            <div class="ext-heading">
              <div class="ext-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="13" r="8" />
                  <path d="M12 9v4l2 2" />
                  <path d="M5 3 2 6" />
                  <path d="m22 6-3-3" />
                  <path d="M6.38 18.7 4 21" />
                  <path d="M17.64 18.67 20 21" />
                </svg>
              </div>
              <div>
                <div class="ext-title-row">
                  <h2 class="ext-title">{{ selectedExternal.name }}</h2>
                  <span v-if="selectedExternal.anomalous" class="anomaly-tag anomaly-tag-lg">
                    {{ t('plugins.external.anomalous') }}
                  </span>
                </div>
                <p class="ext-meta">
                  {{ selectedExternal.id }} · v{{ selectedExternal.version || '—' }}
                </p>
              </div>
            </div>
            <div class="master-switch" :class="{ busy: toggleBusy === selectedExternal.id }">
              <span class="master-label">{{ t('plugins.timer.pluginStatus') }}</span>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="selectedExternal.enabled"
                  :disabled="!!selectedExternal.error || toggleBusy === selectedExternal.id"
                  @change="onToggleExternal(selectedExternal.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="slider" />
              </label>
            </div>
        </header>

        <div class="external-content">
          <OverlayScrollbar>
            <div class="external-body plugin-detail">
            <p v-if="selectedExternal.error" class="ext-error">
              {{ selectedExternal.error }}
            </p>
            <p v-else class="ext-desc">
              {{ selectedExternal.description || t('plugins.external.noDescription') }}
            </p>

            <dl class="ext-dl">
              <div>
                <dt>{{ t('plugins.external.events') }}</dt>
                <dd>
                  <code v-if="selectedExternal.events.length">{{ selectedExternal.events.join(', ') }}</code>
                  <span v-else>{{ t('plugins.external.anyKind') }}</span>
                </dd>
              </div>
              <div>
                <dt>{{ t('plugins.external.main') }}</dt>
                <dd>
                  <code v-if="selectedExternal.main">{{ selectedExternal.main }}</code>
                  <span v-else>{{ t('plugins.external.noUi') }}</span>
                </dd>
              </div>
              <div>
                <dt>{{ t('plugins.external.dir') }}</dt>
                <dd><code class="path">{{ selectedExternal.dir }}</code></dd>
              </div>
            </dl>

            <div v-if="!selectedExternal.error" class="ext-actions-card">
              <button
                type="button"
                class="btn-primary"
                :disabled="!selectedExternal.enabled || testingId === selectedExternal.id"
                @click="onTestExternal(selectedExternal)"
              >
                {{
                  testingId === selectedExternal.id
                    ? t('plugins.external.testing')
                    : t('plugins.external.testBtn')
                }}
              </button>
              <span v-if="!selectedExternal.enabled" class="ext-actions-hint">
                {{ t('plugins.external.testNeedEnable') }}
              </span>
            </div>

              <p class="ext-trust">{{ t('plugins.external.trustNote') }}</p>
            </div>
          </OverlayScrollbar>
        </div>
      </div>

      <div v-else class="external-detail empty-detail">
        <div class="plugin-detail">
          <p class="ext-desc">{{ t('plugins.external.selectHint') }}</p>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.plugins-page {
  display: flex;
  height: 100%;
  min-height: 0;
  background: #f8fafc;
  box-sizing: border-box;
  overflow: hidden;
}

/* ---- left rail ---- */
.plugin-rail {
  width: 15rem;
  min-width: 15rem;
  flex: 0 0 15rem;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 0.0625rem solid #e2e8f0;
  min-height: 0;
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
  overflow: hidden;
}

.rail-list-content {
  min-height: 100%;
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

/* ---- main ---- */
.plugin-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(248, 250, 252, 0.7);
}

.plugin-detail {
  width: 100%;
  max-width: 64rem;
  min-height: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 1.5rem 2rem 2rem;
}

/* external detail */
.external-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.external-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.empty-detail {
  overflow: hidden;
}

.ext-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  flex: none;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}

.ext-heading {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

.ext-icon {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  background: #d1fae5;
  color: #059669;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ext-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ext-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #1e293b;
}

.ext-meta {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: #94a3b8;
}

.master-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.7rem;
  background: #f1f5f9;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.625rem;
}

.master-switch.busy {
  opacity: 0.7;
}

.master-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
}

.external-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.ext-desc {
  margin: 0;
  font-size: 0.875rem;
  color: #475569;
  line-height: 1.5;
}

.ext-error {
  margin: 0;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.8125rem;
}

.ext-dl {
  margin: 0;
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  background: #fff;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.875rem;
}
.ext-dl dt {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.03rem;
  margin-bottom: 0.2rem;
}
.ext-dl dd {
  margin: 0;
  font-size: 0.8125rem;
  color: #334155;
  word-break: break-all;
}
.ext-dl code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  background: #f8fafc;
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
}
.ext-dl code.path {
  display: inline-block;
  max-width: 100%;
}

.ext-actions-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 1rem;
  background: #fff;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.875rem;
}

.ext-actions-hint {
  font-size: 0.75rem;
  color: #94a3b8;
}

.btn-primary {
  border: none;
  background: #7c3aed;
  color: #fff;
  border-radius: 0.5rem;
  padding: 0.5rem 0.9rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) {
  background: #6d28d9;
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: default;
}

.ext-trust {
  margin: 0;
  font-size: 0.75rem;
  color: #94a3b8;
  line-height: 1.45;
}

.switch {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  position: relative;
}
.switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  width: 2.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: #cbd5e1;
  position: relative;
  transition: background 0.15s ease;
  flex-shrink: 0;
}
.slider::after {
  content: '';
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.15);
  transition: transform 0.15s ease;
}
.switch input:checked + .slider {
  background: #7c3aed;
}
.switch input:checked + .slider::after {
  transform: translateX(1rem);
}
.switch input:disabled + .slider {
  opacity: 0.5;
}

@media (max-width: 56.25rem) {
  .plugin-rail {
    width: 15rem;
    min-width: 15rem;
    flex-basis: 15rem;
  }

  .plugin-detail {
    padding: 1.25rem;
  }

  .ext-header {
    padding: 1rem 1.25rem;
  }
}
</style>
