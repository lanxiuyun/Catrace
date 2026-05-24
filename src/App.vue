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
