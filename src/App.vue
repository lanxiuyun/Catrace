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
  <n-config-provider>
    <n-message-provider>
      <n-layout has-sider style="height: 100vh">
        <n-layout-sider bordered :collapsed-width="64" :width="180">
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
.logo {
  padding: 16px;
  font-size: 18px;
  font-weight: bold;
  text-align: center;
}
</style>
