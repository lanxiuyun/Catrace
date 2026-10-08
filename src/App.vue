<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
} from 'naive-ui'
import {
  zhCN as naiveZhCN,
  enUS as naiveEnUS,
  dateZhCN,
  dateEnUS,
} from 'naive-ui'
import { useTheme } from './composables/useTheme'

const { locale } = useI18n()
const { naiveTheme, naiveOverrides } = useTheme()

const naiveLocale = computed(() => {
  return locale.value === 'zh-CN' ? naiveZhCN : naiveEnUS
})

const naiveDateLocale = computed(() => {
  return locale.value === 'zh-CN' ? dateZhCN : dateEnUS
})
</script>

<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="naiveOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
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
  background: transparent;
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
