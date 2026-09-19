<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { load, type Store } from '@tauri-apps/plugin-store'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { AlarmClock, Armchair, Cpu } from '@lucide/vue'
import RestPluginPanel from '../../components/plugins/RestPluginPanel.vue'
import PageScroll from '../../components/PageScroll.vue'
import PluginPanelHeader from '../../components/plugins/PluginPanelHeader.vue'
import PluginNavRail, { type PluginNavItem } from '../../components/plugins/PluginNavRail.vue'
import { usePluginRegistry } from '../../stores/pluginRegistry'
import {
  listExternalPlugins,
  setExternalPluginEnabled,
  openPluginsDir,
  installExternalPlugin,
  getPluginIconDataUrl,
  getNodeRuntimeStatus,
  installNodeRuntime,
  sidecarNeedsNode,
  pickPluginFolder,
  pickPluginZip,
  publishEvent,
  type ExternalPluginInfo,
  type NodeRuntimeStatus,
} from '../../api/tauri'
import { loadExternalPlugins } from '../../plugins/loadExternalPlugins'

const { t } = useI18n()
const message = useMessage()
const pluginRegistry = usePluginRegistry()

const VISIBLE_PLUGIN_IDS = ['rest'] as const
type VisiblePluginId = (typeof VISIBLE_PLUGIN_IDS)[number]

const selectedId = ref<string>('')
const externalList = ref<ExternalPluginInfo[]>([])
const iconUrls = ref<Record<string, string | null>>({})
const loading = ref(false)
const toggleBusy = ref<string | null>(null)
const testingId = ref<string | null>(null)
const searchQuery = ref('')
const builtinEnabled = ref<Record<VisiblePluginId, boolean>>({
  rest: true,
})

let settingsStore: Store | null = null
let unlistenPluginAnomaly: UnlistenFn | null = null
let unlistenPluginConfigSaveFailed: UnlistenFn | null = null
let unlistenPluginConfigChanged: UnlistenFn | null = null
let unlistenNodeProgress: UnlistenFn | null = null

// ---------- Node runtime (sidecar plugins) ----------
const nodeStatus = ref<NodeRuntimeStatus | null>(null)
const nodeInstalling = ref(false)
const nodeProgress = ref<{ received: number; total: number } | null>(null)

const nodeProgressPct = computed(() => {
  const p = nodeProgress.value
  if (!p || !p.total) return 0
  return Math.min(100, Math.round((p.received / p.total) * 100))
})

/** 选中插件经 sidecar 跑 node，且当前解析不到 node 运行时。 */
const selectedNeedsNode = computed(
  () =>
    !!selectedExternal.value &&
    !selectedExternal.value.error &&
    sidecarNeedsNode(selectedExternal.value.sidecar) &&
    nodeStatus.value?.available === false,
)

async function onInstallNodeRuntime() {
  if (nodeInstalling.value) return
  nodeInstalling.value = true
  nodeProgress.value = null
  try {
    await installNodeRuntime()
    nodeStatus.value = await getNodeRuntimeStatus()
    message.success(t('plugins.nodeRuntime.installOk'))
    // 插件已启用但 sidecar 之前起不来：重新同步，把 sidecar 拉起来。
    if (selectedExternal.value?.enabled) {
      await onToggleExternal(selectedExternal.value.id, true)
    }
  } catch (e) {
    console.warn('[plugins page] node runtime install failed', e)
    message.error(t('plugins.nodeRuntime.installFailed'))
  } finally {
    nodeInstalling.value = false
    nodeProgress.value = null
  }
}
async function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return settingsStore
}

function onBuiltinPluginEnabledChanged(event: Event) {
  const detail = (event as CustomEvent<{ id?: string; enabled?: boolean }>).detail
  if (detail?.id && typeof detail.enabled === 'boolean') {
    if ((VISIBLE_PLUGIN_IDS as readonly string[]).includes(detail.id)) {
      builtinEnabled.value[detail.id as VisiblePluginId] = detail.enabled
    }
    // External settings.mjs may toggle enable — keep list in sync.
    externalList.value = externalList.value.map((p) =>
      p.id === detail.id ? { ...p, enabled: detail.enabled! } : p,
    )
    return
  }
  void refreshBuiltinEnabled()
}

async function refreshBuiltinEnabled() {
  try {
    const store = await getSettingsStore()
    const rest = await store.get<{ enabled?: boolean }>('plugin_config:rest')
    builtinEnabled.value.rest = rest?.enabled ?? true
  } catch {
    builtinEnabled.value.rest = false
  }
}

async function refreshExternal(restartSidecars = false) {
  loading.value = true
  try {
    externalList.value = await listExternalPlugins({ restartSidecars })
    // force: user clicked refresh / toggled enable — rebuild Card blobs.
    await loadExternalPlugins({ force: true })
    await hydratePluginIcons()
    // Toast window has its own Pinia — ask it to reload UI too.
    const { emit } = await import('@tauri-apps/api/event')
    await emit('catrace:reload-external-plugins')
  } catch (e) {
    console.warn('[plugins page] refresh failed', e)
  } finally {
    loading.value = false
  }
}

async function hydratePluginIcons(list: ExternalPluginInfo[] = externalList.value) {
  const next: Record<string, string | null> = {}
  await Promise.all(
    list
      .filter((p) => !p.error && !!p.icon)
      .map(async (p) => {
        next[p.id] = await getPluginIconDataUrl(p.id)
      }),
  )
  iconUrls.value = next
}

onMounted(async () => {
  await Promise.all([refreshBuiltinEnabled(), refreshExternal()])
  await hydratePluginIcons()
  if (!selectedId.value && plugins.value.length) {
    selectedId.value = plugins.value[0].id
  }
  void getNodeRuntimeStatus()
    .then((s) => {
      nodeStatus.value = s
    })
    .catch((e) => console.warn('[plugins page] node status failed', e))
  void listen<{ received: number; total: number }>(
    'node-install-progress',
    ({ payload }) => {
      nodeProgress.value = payload
    },
  ).then((unlisten) => {
    unlistenNodeProgress = unlisten
  })
  void listen<string>('catrace:plugin-anomaly', ({ payload: pluginId }) => {
    const plugin = externalList.value.find((item) => item.id === pluginId)
    if (plugin) plugin.anomalous = true
  }).then((unlisten) => {
    unlistenPluginAnomaly = unlisten
  })
  void listen('catrace:plugin-config-save-failed', () => {
    message.error(t('settings.messages.saveFailed'))
  }).then((unlisten) => {
    unlistenPluginConfigSaveFailed = unlisten
  })
  // Bridge host config writes (e.g. toast block-app in plugin background window)
  // into main-window CustomEvent so settings.mjs can refresh without remount.
  void listen<{ pluginId?: string }>('catrace:plugin-config-changed', ({ payload }) => {
    window.dispatchEvent(
      new CustomEvent('catrace:plugin-config-changed', {
        detail: { pluginId: payload?.pluginId },
      }),
    )
  }).then((unlisten) => {
    unlistenPluginConfigChanged = unlisten
  })
  window.addEventListener('catrace:plugin-enabled-changed', onBuiltinPluginEnabledChanged)
})

onBeforeUnmount(() => {
  unlistenPluginAnomaly?.()
  unlistenPluginConfigSaveFailed?.()
  unlistenPluginConfigChanged?.()
  unlistenNodeProgress?.()
  window.removeEventListener('catrace:plugin-enabled-changed', onBuiltinPluginEnabledChanged)
})

/** 调试用插件（宿主自带，用于验证能力）——不参与启用优先，恒定沉底。 */
const DEBUG_PLUGIN_IDS = ['notify-demo', 'sidecar-echo'] as const

const plugins = computed((): PluginNavItem[] => {  const builtins = VISIBLE_PLUGIN_IDS.map((id) => {
    const handle = pluginRegistry.getPlugin(id)
    return {
      id,
      name: t(`plugins.${id}.name`),
      subtitle: t(`plugins.${id}.listSubtitle`),
      external: false,
      enabled: builtinEnabled.value[id],
      registered: !!handle,
      error: null,
      anomalous: false,
      version: handle?.manifest.version,
      tone: id,
    }
  })
  const externals: PluginNavItem[] = externalList.value.map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: p.error
      ? p.error
      : p.description || t('plugins.external.localPackage'),
    external: true,
    enabled: p.enabled,
    registered: !p.error,
    error: p.error ?? null,
    anomalous: p.anomalous,
    version: p.version,
    icon: iconUrls.value[p.id] ?? null,
    tone: 'external',
  }))
  const debugRank = (item: { id: string; enabled: boolean; name: string }) =>
    (DEBUG_PLUGIN_IDS as readonly string[]).includes(item.id) ? 1 : 0
  return [...builtins, ...externals].sort((a, b) => {
    const ad = debugRank(a)
    const bd = debugRank(b)
    if (ad !== bd) return ad - bd
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
})

const fallbackDetail: Record<VisiblePluginId, Component> = {
  rest: RestPluginPanel,
}

const selectedExternal = computed(() =>
  externalList.value.find((p) => p.id === selectedId.value) ?? null,
)

const isBuiltinSelected = computed(() =>
  (VISIBLE_PLUGIN_IDS as readonly string[]).includes(selectedId.value),
)

const ActiveDetail = computed(() => {
  if (isBuiltinSelected.value) {
    const id = selectedId.value as VisiblePluginId
    const handle = pluginRegistry.getPlugin(id)
    if (handle?.SettingsComponent) return handle.SettingsComponent
    return fallbackDetail[id]
  }
  // External plugins: mount settings.mjs when available.
  if (selectedExternal.value && !selectedExternal.value.error) {
    const handle = pluginRegistry.getPlugin(selectedId.value)
    if (handle?.SettingsComponent) return handle.SettingsComponent
  }
  return null
})

const activePanelRef = ref<any>(null)

function setActivePanelRef(el: any) {
  activePanelRef.value = isBuiltinSelected.value ? el : null
}

const activeHeader = computed(() => {
  // External plugins: header switch = external enabled (not settings expose).
  if (selectedExternal.value) {
    const ext = selectedExternal.value
    return {
      title: ext.name,
      subtitle: ext.description || t('plugins.external.noDescription'),
      enabled: ext.enabled && !ext.error,
      loading: toggleBusy.value === ext.id,
      switchAria: t('plugins.external.switchAria'),
      onToggle: (val: boolean) => onToggleExternal(ext.id, val),
      icon: 'external',
      iconDataUrl: iconUrls.value[ext.id] ?? null,
    }
  }
  if (isBuiltinSelected.value && ActiveDetail.value) {
    return {
      title: t(`plugins.${selectedId.value}.name`),
      subtitle: t(`plugins.${selectedId.value}.subtitle`),
      enabled: activePanelRef.value?.headerEnabled ?? false,
      loading: activePanelRef.value?.headerLoading ?? false,
      switchAria: t(`plugins.${selectedId.value}.switchAria`),
      onToggle: (val: boolean) => activePanelRef.value?.toggleEnabled?.(val),
      icon: selectedId.value,
      iconDataUrl: null,
    }
  }
  return null
})

async function onToggleExternal(id: string, enabled: boolean) {
  const previous = externalList.value.find((p) => p.id === id)
  if (!previous) return
  externalList.value = externalList.value.map((p) =>
    p.id === id ? { ...p, enabled } : p,
  )
  toggleBusy.value = id
  try {
    const updated = await setExternalPluginEnabled(id, enabled)
    externalList.value = externalList.value.map((p) =>
      p.id === id ? updated : p,
    )
    await loadExternalPlugins()
  } catch (e) {
    console.warn('[plugins page] toggle failed', e)
    externalList.value = externalList.value.map((p) =>
      p.id === id ? previous : p,
    )
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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function installFromPath(sourcePath: string) {
  loading.value = true
  try {
    let result = await installExternalPlugin(sourcePath, false).catch(async (error) => {
      const text = errorText(error)
      if (!/already installed|overwrite/i.test(text)) throw error
      const idMatch = text.match(/plugin '([^']+)'/i) || text.match(/plugin «([^»]+)»/i)
      const id = idMatch?.[1] || 'plugin'
      const ok = window.confirm(t('plugins.external.installOverwriteConfirm', { id }))
      if (!ok) {
        message.info(t('plugins.external.installCancelled'))
        return null
      }
      return installExternalPlugin(sourcePath, true)
    })
    if (!result) return
    await refreshExternal()
    await loadExternalPlugins()
    selectedId.value = result.id
    message.success(
      result.overwritten
        ? t('plugins.external.installOverwriteOk', {
            name: result.name,
            version: result.version,
          })
        : t('plugins.external.installOk', {
            name: result.name,
            version: result.version,
          }),
    )
  } catch (error) {
    console.warn('[plugins page] install failed', error)
    message.error(t('plugins.external.installFailed', { error: errorText(error) }))
  } finally {
    loading.value = false
  }
}

async function onInstallFolder() {
  try {
    const path = await pickPluginFolder()
    if (!path) return
    await installFromPath(path)
  } catch (error) {
    message.error(t('plugins.external.installFailed', { error: errorText(error) }))
  }
}

async function onInstallZip() {
  try {
    const path = await pickPluginZip()
    if (!path) return
    await installFromPath(path)
  } catch (error) {
    message.error(t('plugins.external.installFailed', { error: errorText(error) }))
  }
}

async function onTestExternal(p: ExternalPluginInfo) {
  if (!p.enabled || p.error || testingId.value) return
  testingId.value = p.id
  try {
    // mtime-aware rebuild (no force): disk edits to ui/settings produce a new fingerprint.
    // Then tell the toast window to clear its card cache and pick up fresh blob URLs so
    // live PluginHostCards remount instead of sticking to the first import of the session.
    await loadExternalPlugins()
    const { emit } = await import('@tauri-apps/api/event')
    await emit('catrace:reload-external-plugins')
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
    <plugin-nav-rail
      v-model:selected-id="selectedId"
      v-model:search-query="searchQuery"
      :items="plugins"
      :loading="loading"
      @refresh="() => refreshExternal(true)"
      @open-dir="onOpenDir"
      @install-folder="onInstallFolder"
      @install-zip="onInstallZip"
    />

    <!-- 主内容 -->
    <main class="plugin-main">
      <plugin-panel-header
        v-if="activeHeader"
        :title="activeHeader.title"
        :subtitle="activeHeader.subtitle"
        :enabled="activeHeader.enabled"
        :loading="activeHeader.loading"
        :switch-aria-label="activeHeader.switchAria"
        @update:enabled="activeHeader.onToggle"
      >
        <template #icon>
          <img
            v-if="activeHeader.iconDataUrl"
            :src="activeHeader.iconDataUrl"
            alt=""
            class="header-icon-img"
          />
          <component
            v-else-if="activeHeader.icon === 'rest'"
            :is="Armchair"
            :size="22"
            :stroke-width="2"
            aria-hidden="true"
          />
          <component
            v-else-if="activeHeader.icon === 'external'"
            :is="AlarmClock"
            :size="22"
            :stroke-width="2"
            aria-hidden="true"
          />
        </template>
      </plugin-panel-header>

      <page-scroll fill-content class="plugin-scroll">
        <div v-if="ActiveDetail" class="plugin-detail-wrapper">
          <div
            class="plugin-detail-content"
            :class="{ 'is-disabled': activeHeader && !activeHeader.enabled }"
          >
            <div class="plugin-detail">
              <component
                :is="ActiveDetail"
                :key="selectedId"
                :ref="isBuiltinSelected ? setActivePanelRef : undefined"
              />
            </div>
          </div>
          <div v-if="activeHeader && !activeHeader.enabled" class="disabled-overlay" />
        </div>
        <div v-else-if="selectedExternal" class="plugin-detail-wrapper">
          <div
            class="plugin-detail-content"
            :class="{ 'is-disabled': !selectedExternal.enabled }"
          >
            <div class="plugin-detail">
              <p v-if="selectedExternal.error" class="ext-error">
                {{ selectedExternal.error }}
              </p>
              <template v-else>
                <p class="ext-placeholder">{{ t('plugins.external.settingsPlaceholder') }}</p>
                <div class="ext-actions-card">
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
              </template>
            </div>
          </div>
          <div v-if="!selectedExternal.enabled" class="disabled-overlay" />
        </div>
      </page-scroll>

      <div
        v-if="selectedExternal && !selectedExternal.error && selectedNeedsNode && nodeStatus"
        class="node-runtime-gate"
        role="dialog"
        aria-modal="true"
        :aria-label="t('plugins.nodeRuntime.title')"
      >
        <div class="node-runtime-card">
          <div class="node-runtime-icon" aria-hidden="true">
            <Cpu :size="26" :stroke-width="1.8" />
          </div>
          <div class="node-runtime-heading">
            <h3>{{ t('plugins.nodeRuntime.title') }}</h3>
            <span class="node-runtime-pill">
              {{ t('plugins.nodeRuntime.portable', { version: nodeStatus.version }) }}
            </span>
          </div>
          <p class="node-runtime-desc">{{ t('plugins.nodeRuntime.desc') }}</p>
          <div v-if="nodeInstalling" class="node-runtime-progress">
            <div class="node-runtime-progress-row">
              <span>{{ t('plugins.nodeRuntime.progress') }}</span>
              <strong>{{ nodeProgressPct }}%</strong>
            </div>
            <div class="node-runtime-bar">
              <div
                class="node-runtime-bar-fill"
                :style="{ width: nodeProgressPct + '%' }"
              />
            </div>
          </div>
          <button
            type="button"
            class="btn-primary node-runtime-btn"
            :disabled="nodeInstalling"
            @click="onInstallNodeRuntime"
          >
            {{
              nodeInstalling
                ? t('plugins.nodeRuntime.installingShort')
                : t('plugins.nodeRuntime.install')
            }}
          </button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.plugins-page {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--ct-bg);
  box-sizing: border-box;
}

.plugin-main {
  position: relative;
  isolation: isolate;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ct-bg);
}

.plugin-scroll {
  flex: 1;
}

.plugin-detail-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100%;
}

.plugin-detail-content {
  flex: 1;
}

.plugin-detail-content.is-disabled {
  opacity: 0.65;
  filter: grayscale(0.45);
  pointer-events: none;
}

.plugin-detail {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 64rem;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 1.5rem 1rem 2rem;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}

.plugin-detail :where(h1, h2, h3, p, button, input, textarea, label, span, li) {
  font-family: inherit;
  line-height: inherit;
}

.disabled-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--ct-bg) 25%, transparent);
}

.ext-placeholder {
  margin: 0;
  padding: 2.5rem 1rem;
  text-align: center;
  border-radius: 0.875rem;
  border: 0.0625rem dashed var(--ct-border);
  background: var(--ct-surface);
  color: var(--ct-text-subtle);
  font-size: 0.875rem;
}

.ext-error {
  margin: 0;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--ct-error-soft);
  color: var(--ct-error-strong);
  font-size: 0.8125rem;
}

.node-runtime-gate {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: color-mix(in srgb, var(--ct-bg) 88%, transparent);
  backdrop-filter: blur(0.375rem) grayscale(0.35);
}

.node-runtime-card {
  width: min(27rem, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 2rem 2rem 1.75rem;
  text-align: center;
  background: var(--ct-surface);
  border: 0.0625rem solid var(--ct-border);
  border-radius: 1.125rem;
  box-shadow:
    0 1.25rem 3rem rgb(15 23 42 / 0.14),
    0 0.25rem 0.75rem rgb(15 23 42 / 0.06);
}

.node-runtime-icon {
  width: 3.5rem;
  height: 3.5rem;
  margin-bottom: 1rem;
  border-radius: 1rem;
  background: var(--ct-accent-softer);
  color: var(--ct-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 0.0625rem var(--ct-accent-soft);
}

.node-runtime-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.node-runtime-heading h3 {
  margin: 0;
  color: var(--ct-text);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.node-runtime-pill {
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: var(--ct-accent-softer);
  color: var(--ct-accent);
  font-size: 0.625rem;
  font-weight: 600;
  white-space: nowrap;
}

.node-runtime-desc {
  max-width: 22rem;
  margin: 0.625rem 0 1.25rem;
  color: var(--ct-text-subtle);
  font-size: 0.75rem;
  line-height: 1.6;
}

.node-runtime-progress {
  width: 100%;
  margin: 0 0 1rem;
}

.node-runtime-progress-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.375rem;
  color: var(--ct-text-subtle);
  font-size: 0.6875rem;
}

.node-runtime-progress-row strong {
  color: var(--ct-accent);
  font-weight: 600;
}

.node-runtime-btn {
  min-width: 12rem;
  padding: 0.625rem 1.25rem;
}

.node-runtime-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.node-runtime-bar {
  height: 0.3125rem;
  border-radius: 999px;
  background: var(--ct-surface-2);
  overflow: hidden;
}

.node-runtime-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--ct-accent);
  transition: width 0.3s ease;
}

.ext-actions-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 1rem;
  background: var(--ct-surface);
  border: 0.0625rem solid var(--ct-border);
  border-radius: 0.875rem;
}

.ext-actions-hint {
  font-size: 0.75rem;
  color: var(--ct-text-subtle);
}

.btn-primary {
  border: none;
  background: var(--ct-accent);
  color: var(--ct-on-accent);
  border-radius: 0.5rem;
  padding: 0.5rem 0.9rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: var(--ct-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
