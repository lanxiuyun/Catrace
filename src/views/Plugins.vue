<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import RestPluginPanel from '../components/plugins/RestPluginPanel.vue'
import TimerPluginPanel from '../components/plugins/TimerPluginPanel.vue'
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

const VISIBLE_PLUGIN_IDS = ['rest', 'timer', 'agent'] as const
type VisiblePluginId = (typeof VISIBLE_PLUGIN_IDS)[number]

const selectedId = ref<string>('timer')
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
    tone: 'external',
  }))
  return [...builtins, ...externals]
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
        <h1 class="rail-title">{{ t('plugins.pageTitle') }}</h1>
        <div class="rail-actions">
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
          <button
            type="button"
            class="icon-btn"
            :title="t('plugins.external.openDir')"
            @click="onOpenDir"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </button>
        </div>
      </div>

      <div class="rail-list">
        <button
          v-for="p in plugins"
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
            </div>
            <div class="item-sub">{{ p.subtitle }}</div>
          </div>
        </button>

        <p v-if="!externalList.length && !loading" class="list-hint">
          {{ t('plugins.external.emptyHint') }}
        </p>
      </div>
    </aside>

    <!-- 主内容 -->
    <main class="plugin-main">
      <div class="plugin-detail">
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
                <h2 class="ext-title">{{ selectedExternal.name }}</h2>
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

          <div class="external-body">
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
        </div>

        <div v-else class="external-detail">
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
  width: 14rem;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 0.0625rem solid #e2e8f0;
  min-height: 0;
}

.rail-header {
  height: 4rem;
  padding: 0 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 0.0625rem solid #f1f5f9;
  flex-shrink: 0;
}

.rail-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #1e293b;
}

.rail-actions {
  display: flex;
  gap: 0.15rem;
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

.rail-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.list-hint {
  margin: 0.5rem 0.5rem 0;
  font-size: 0.75rem;
  color: #94a3b8;
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
  border-radius: 0.625rem;
  padding: 0.625rem 0.7rem;
  cursor: pointer;
  color: #334155;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.plugin-item:hover {
  background: #f8fafc;
}

.plugin-item:focus-visible {
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
  min-width: 0;
}

.item-name {
  font-size: 0.875rem;
  font-weight: 500;
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

.item-sub {
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: #94a3b8;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- main ---- */
.plugin-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  background: rgba(248, 250, 252, 0.7);
}

.plugin-detail {
  min-height: 100%;
  box-sizing: border-box;
  padding: 1.5rem 2rem 2rem;
  max-width: 72rem;
}

/* external detail */
.external-detail {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.ext-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding-bottom: 1rem;
  border-bottom: 0.0625rem solid #e2e8f0;
  background: transparent;
  margin: 0;
  padding: 0 0 1rem;
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
  .plugins-page {
    flex-direction: column;
    overflow: auto;
  }

  .plugin-rail {
    width: 100%;
    border-right: none;
    border-bottom: 0.0625rem solid #e2e8f0;
    max-height: 14rem;
  }

  .plugin-detail {
    padding: 1.25rem;
  }

  .ext-header {
    margin: 0;
    padding: 0 0 1rem;
  }
}
</style>
