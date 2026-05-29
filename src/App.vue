<script setup lang="ts">
import { h, computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NConfigProvider,
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NMenu,
  NMessageProvider,
} from 'naive-ui'
import { themeOverrides } from './theme'
import { zhCN as naiveZhCN, enUS as naiveEnUS } from 'naive-ui'
import ReminderPopup from './views/ReminderPopup.vue'
import ReminderFullscreen from './views/ReminderFullscreen.vue'

const route = useRoute()
const { t, locale } = useI18n()

const naiveLocale = computed(() => {
  return locale.value === 'zh-CN' ? naiveZhCN : naiveEnUS
})

const menuOptions = computed(() => [
  {
    label: () => h(RouterLink, { to: '/dashboard' }, { default: () => t('nav.overview') }),
    key: '/dashboard',
  },
  {
    label: () => h(RouterLink, { to: '/settings' }, { default: () => t('nav.settings') }),
    key: '/settings',
  },
  {
    label: () => h(RouterLink, { to: '/debug' }, { default: () => t('nav.debug') }),
    key: '/debug',
  },
])

const isReminderRoute = computed(() => {
  const type = (window as any).__CATRACE_REMINDER_TYPE__
  return type === 'popup' || type === 'fullscreen'
    || route.path === '/reminder-popup'
    || route.path === '/reminder-fullscreen'
})

const currentReminderType = computed(() => {
  return (window as any).__CATRACE_REMINDER_TYPE__ || ''
})
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="naiveLocale">
    <n-message-provider>
      <template v-if="isReminderRoute">
        <ReminderPopup v-if="currentReminderType === 'popup' || route.path === '/reminder-popup'" />
        <ReminderFullscreen v-else-if="currentReminderType === 'fullscreen' || route.path === '/reminder-fullscreen'" />
        <RouterView v-else />
      </template>
      <n-layout v-else has-sider class="app-layout">
        <n-layout-sider
          bordered
          :collapsed-width="64"
          :width="180"
          class="app-sider"
        >
          <div class="logo">Catrace</div>
          <n-menu :value="route.path" :options="menuOptions" />
        </n-layout-sider>
        <n-layout-content class="app-content" :native-scrollbar="false">
          <RouterView />
        </n-layout-content>
      </n-layout>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
html, body, #app {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #f7f5fa;
}

.app-layout {
  height: 100vh;
  overflow: hidden;
  background: #f7f5fa;
}

.app-content {
  height: 100vh;
}

.app-content :deep(.n-layout-scroll-container) {
  overflow-y: auto;
  overflow-x: hidden;
}

.app-sider {
  background: #ffffff !important;
  border-right-color: #ebe6f2 !important;
}

.app-sider :deep(.n-layout-sider-scroll-container) {
  background: #FFFFFF;
}

.logo {
  padding: 24px 16px 20px;
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  color: #6d28d9;
  letter-spacing: -0.02em;
}

.app-sider :deep(.n-menu-item-content) {
  border-radius: 10px;
  margin: 2px 8px;
}

.app-sider :deep(.n-menu-item-content::before) {
  border-radius: 10px !important;
  left: 8px !important;
  right: 8px !important;
}

.app-sider :deep(.n-menu .router-link-active) {
  color: inherit;
  text-decoration: none;
}
</style>
