<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
} from 'naive-ui'
import { themeOverrides } from './theme'
import { zhCN as naiveZhCN, enUS as naiveEnUS } from 'naive-ui'

const { locale } = useI18n()

const naiveLocale = computed(() => {
  return locale.value === 'zh-CN' ? naiveZhCN : naiveEnUS
})
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="naiveLocale">
    <n-message-provider>
      <n-dialog-provider>
        <RouterView />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
html, body, #app {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #f8fafc;
}

* {
  -webkit-user-select: none;
  user-select: none;
}

input,
textarea,
[contenteditable="true"] {
  -webkit-user-select: auto;
  user-select: auto;
}
</style>
