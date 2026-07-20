<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import RestPluginPanel from '../components/plugins/RestPluginPanel.vue'
import AgentPluginPanel from '../components/plugins/AgentPluginPanel.vue'
import { usePluginRegistry } from '../stores/pluginRegistry'
import {
  listExternalPlugins,
  setExternalPluginEnabled,
  openPluginsDir,
  publishEvent,
  type ExternalPluginInfo,
} from '../api/tauri'
import { loadExternalPlugins } from '../plugins/loadExternalPlugins'

const { t } = useI18n()
const pluginRegistry = usePluginRegistry()

const VISIBLE_PLUGIN_IDS = ['rest', 'agent'] as const
type VisiblePluginId = (typeof VISIBLE_PLUGIN_IDS)[number]

const selectedId = ref<string>('rest')
const externalList = ref<ExternalPluginInfo[]>([])
const loading = ref(false)
const toggleBusy = ref<string | null>(null)
const testingId = ref<string | null>(null)

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
  void refreshExternal()
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
      enabled: true,
      version: handle?.manifest.version,
      error: null as string | null,
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
  }))
  return [...builtins, ...externals]
})

const fallbackDetail: Record<VisiblePluginId, Component> = {
  rest: RestPluginPanel,
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
    <header class="page-header">
      <div class="header-row">
        <div>
          <h1 class="page-title">{{ t('plugins.pageTitle') }}</h1>
          <p class="page-subtitle">{{ t('plugins.pageSubtitle') }}</p>
        </div>
        <div class="header-actions">
          <button type="button" class="btn-secondary" @click="refreshExternal" :disabled="loading">
            {{ t('plugins.external.refresh') }}
          </button>
          <button type="button" class="btn-secondary" @click="onOpenDir">
            {{ t('plugins.external.openDir') }}
          </button>
        </div>
      </div>
    </header>

    <div class="plugins-layout">
      <aside class="plugin-list" :aria-label="t('plugins.listHeading')">
        <div class="list-heading">{{ t('plugins.listHeading') }}</div>
        <button
          v-for="p in plugins"
          :key="p.id"
          type="button"
          class="plugin-item"
          :class="{ active: selectedId === p.id, disabled: !!p.error }"
          :aria-current="selectedId === p.id ? 'page' : undefined"
          @click="selectedId = p.id"
        >
          <div class="item-icon" aria-hidden="true">
            <svg v-if="p.id === 'rest'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div class="item-text">
            <div class="item-name">
              {{ p.name }}
              <span v-if="p.external && p.version" class="ver">v{{ p.version }}</span>
            </div>
            <div class="item-sub">{{ p.subtitle }}</div>
          </div>
        </button>
        <p v-if="!externalList.length && !loading" class="list-hint">
          {{ t('plugins.external.emptyHint') }}
        </p>
      </aside>

      <main class="plugin-detail">
        <component v-if="ActiveDetail" :is="ActiveDetail" :key="selectedId" />

        <div v-else-if="selectedExternal" class="external-detail">
          <div class="ext-header">
            <div>
              <h2 class="ext-title">{{ selectedExternal.name }}</h2>
              <p class="ext-meta">
                {{ selectedExternal.id }} · v{{ selectedExternal.version || '—' }}
              </p>
            </div>
            <label class="switch" :class="{ busy: toggleBusy === selectedExternal.id }">
              <input
                type="checkbox"
                :checked="selectedExternal.enabled"
                :disabled="!!selectedExternal.error || toggleBusy === selectedExternal.id"
                @change="onToggleExternal(selectedExternal.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider" />
              <span class="switch-label">
                {{ selectedExternal.enabled ? t('plugins.external.enabled') : t('plugins.external.disabled') }}
              </span>
            </label>
          </div>

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

          <div v-if="!selectedExternal.error" class="ext-actions">
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

        <div v-else class="external-detail">
          <p class="ext-desc">{{ t('plugins.external.selectHint') }}</p>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.plugins-page {
  padding: 1.25rem;
  box-sizing: border-box;
  min-height: 100%;
}

.page-header {
  margin-bottom: 1rem;
}

.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-secondary {
  border: 0.0625rem solid #ebe6f2;
  background: #fff;
  color: #5b21b6;
  border-radius: 0.5rem;
  padding: 0.4rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}
.btn-secondary:hover:not(:disabled) {
  background: #f5f3ff;
}
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: default;
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
  filter: brightness(1.05);
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: default;
}

.ext-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-top: 0.25rem;
}
.ext-actions-hint {
  font-size: 0.75rem;
  color: #8b7aab;
}

.page-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: #2e1065;
}

.page-subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.875rem;
  color: #8b7aab;
}

.plugins-layout {
  display: grid;
  grid-template-columns: 15.5rem minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.plugin-list {
  background: #fff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.875rem;
  padding: 0.75rem;
  position: sticky;
  top: 0.5rem;
}

.list-heading {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #8b7aab;
  text-transform: uppercase;
  letter-spacing: 0.03rem;
  padding: 0.25rem 0.5rem 0.625rem;
}

.list-hint {
  margin: 0.5rem 0.5rem 0;
  font-size: 0.75rem;
  color: #a78bfa;
  line-height: 1.4;
}

.plugin-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-align: left;
  border: 0.0625rem solid transparent;
  background: transparent;
  border-radius: 0.75rem;
  padding: 0.75rem;
  cursor: pointer;
  color: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.plugin-item:hover {
  background: #f5f3ff;
}

.plugin-item:focus-visible {
  outline: 0.125rem solid #7c3aed;
  outline-offset: 0.125rem;
}

.plugin-item.active {
  background: #f5f3ff;
  border-color: #c4b5fd;
  box-shadow: inset 0.1875rem 0 0 #6d28d9;
}

.plugin-item.disabled .item-name {
  color: #9ca3af;
}

.item-icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: #ede9fe;
  color: #6d28d9;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.plugin-item.active .item-icon {
  background: #ddd6fe;
}

.item-text {
  min-width: 0;
}

.item-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2e1065;
  line-height: 1.3;
}

.ver {
  margin-left: 0.35rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: #8b7aab;
}

.item-sub {
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: #8b7aab;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-detail {
  background: #fff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.875rem;
  padding: 1.25rem 1.35rem 1.5rem;
  min-height: 20rem;
  box-sizing: border-box;
}

.external-detail {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.ext-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.ext-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: #2e1065;
}

.ext-meta {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: #8b7aab;
}

.ext-desc {
  margin: 0;
  font-size: 0.875rem;
  color: #4c1d95;
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
}
.ext-dl dt {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #8b7aab;
  text-transform: uppercase;
  letter-spacing: 0.03rem;
  margin-bottom: 0.2rem;
}
.ext-dl dd {
  margin: 0;
  font-size: 0.8125rem;
  color: #4c1d95;
  word-break: break-all;
}
.ext-dl code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  background: #f5f3ff;
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
}
.ext-dl code.path {
  display: inline-block;
  max-width: 100%;
}

.ext-trust {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: #8b7aab;
  line-height: 1.45;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
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
  background: #e5e7eb;
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
.switch-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #5b21b6;
}
.switch.busy {
  opacity: 0.7;
}

@media (max-width: 56.25rem) {
  .plugins-layout {
    grid-template-columns: 1fr;
  }

  .plugin-list {
    position: static;
  }
}
</style>
