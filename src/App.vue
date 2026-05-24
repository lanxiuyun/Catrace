<script setup lang="ts">
import { h } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import {
  NConfigProvider,
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NMenu,
  NMessageProvider,
} from 'naive-ui'
import { themeOverrides } from './theme'

const route = useRoute()

const menuOptions = [
  {
    label: () => h(RouterLink, { to: '/dashboard' }, { default: () => '概览' }),
    key: '/dashboard',
  },
  {
    label: () => h(RouterLink, { to: '/settings' }, { default: () => '设置' }),
    key: '/settings',
  },
]
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-layout has-sider class="app-layout">
        <n-layout-sider
          bordered
          :collapsed-width="64"
          :width="180"
          class="app-sider"
        >
          <div class="logo">Catrace</div>
          <n-menu :value="route.path" :options="menuOptions" />
        </n-layout-sider>
        <n-layout-content>
          <RouterView />
        </n-layout-content>
      </n-layout>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
html, body, #app {
  margin: 0;
  background: #FAF5FF;
}

.app-layout {
  height: 100vh;
  background: #FAF5FF;
}

.app-sider {
  background: #FFFFFF !important;
  border-right-color: #EDE9FE !important;
}

.app-sider :deep(.n-layout-sider-scroll-container) {
  background: #FFFFFF;
}

.logo {
  padding: 24px 16px 20px;
  font-size: 20px;
  font-weight: 800;
  text-align: center;
  color: #6D28D9;
  letter-spacing: -0.5px;
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
