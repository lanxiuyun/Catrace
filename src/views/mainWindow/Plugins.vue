<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { load, type Store } from '@tauri-apps/plugin-store'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { AlarmClock, Armchair, Bot } from '@lucide/vue'
import RestPluginPanel from '../../components/plugins/RestPluginPanel.vue'
import AgentPluginPanel from '../../components/plugins/AgentPluginPanel.vue'
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
  pickPluginFolder,
  pickPluginZip,
  publishEvent,
  getAgentNotificationEnabled,
  type ExternalPluginInfo,
} from '../../api/tauri'
import { loadExternalPlugins } from '../../plugins/loadExternalPlugins'

const { t } = useI18n()
const message = useMessage()
const pluginRegistry = usePluginRegistry()

const VISIBLE_PLUGIN_IDS = ['rest', 'agent'] as const
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
  agent: false,
})

let settingsStore: Store | null = null
let unlistenPluginAnomaly: UnlistenFn | null = null
let unlistenPluginConfigSaveFailed: UnlistenFn | null = null
let unlistenPluginConfigChanged: UnlistenFn | null = null
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
  try {
    builtinEnabled.value.agent = await getAgentNotificationEnabled()
  } catch {
    builtinEnabled.value.agent = false
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
  agent: AgentPluginPanel,
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
            v-else-if="activeHeader.icon === 'agent'"
            :is="Bot"
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
    </main>
  </div>
</template>

<style scoped>
.plugins-page {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: #f8fafc;
  box-sizing: border-box;
}

.plugin-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(248, 250, 252, 0.7);
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
}

.disabled-overlay {
  position: absolute;
  inset: 0;
  background: rgba(248, 250, 252, 0.25);
}

.ext-placeholder {
  margin: 0;
  padding: 2.5rem 1rem;
  text-align: center;
  border-radius: 0.875rem;
  border: 0.0625rem dashed #e2e8f0;
  background: #fff;
  color: #94a3b8;
  font-size: 0.875rem;
}

.ext-error {
  margin: 0;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.8125rem;
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
</style>
