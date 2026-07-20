<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import RestPluginPanel from '../components/plugins/RestPluginPanel.vue'
import AgentPluginPanel from '../components/plugins/AgentPluginPanel.vue'
import { usePluginRegistry } from '../stores/pluginRegistry'

const { t } = useI18n()
const pluginRegistry = usePluginRegistry()

/**
 * Product-visible catalog allowlist.
 * Full registry still holds water/eye/agent for bus; surface filters who appears where.
 */
const VISIBLE_PLUGIN_IDS = ['rest', 'agent'] as const
type VisiblePluginId = (typeof VISIBLE_PLUGIN_IDS)[number]

const selectedId = ref<VisiblePluginId>('rest')

const plugins = computed(() =>
  VISIBLE_PLUGIN_IDS.map((id) => {
    const handle = pluginRegistry.getPlugin(id)
    return {
      id,
      name: t(`plugins.${id}.name`),
      subtitle: t(`plugins.${id}.listSubtitle`),
      badge: t(`plugins.${id}.badge`),
      registered: !!handle,
    }
  }),
)

/** Fallback map if registry not ready; prefer SettingsComponent from registry. */
const fallbackDetail: Record<VisiblePluginId, Component> = {
  rest: RestPluginPanel,
  agent: AgentPluginPanel,
}

const ActiveDetail = computed(() => {
  const handle = pluginRegistry.getPlugin(selectedId.value)
  if (handle?.SettingsComponent) return handle.SettingsComponent
  return fallbackDetail[selectedId.value]
})
</script>

<template>
  <div class="plugins-page">
    <header class="page-header">
      <h1 class="page-title">{{ t('plugins.pageTitle') }}</h1>
      <p class="page-subtitle">{{ t('plugins.pageSubtitle') }}</p>
    </header>

    <div class="plugins-layout">
      <aside class="plugin-list" :aria-label="t('plugins.listHeading')">
        <div class="list-heading">{{ t('plugins.listHeading') }}</div>
        <button
          v-for="p in plugins"
          :key="p.id"
          type="button"
          class="plugin-item"
          :class="{ active: selectedId === p.id }"
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
          </div>
          <div class="item-text">
            <div class="item-name">{{ p.name }}</div>
            <div class="item-sub">{{ p.subtitle }}</div>
          </div>
        </button>
      </aside>

      <main class="plugin-detail">
        <component :is="ActiveDetail" :key="selectedId" />
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

@media (max-width: 56.25rem) {
  .plugins-layout {
    grid-template-columns: 1fr;
  }

  .plugin-list {
    position: static;
  }
}
</style>
