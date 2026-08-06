<script setup lang="ts">
import { NScrollbar } from 'naive-ui'

interface Props {
  fillContent?: boolean
}

withDefaults(defineProps<Props>(), {
  fillContent: false,
})
</script>

<template>
  <n-scrollbar
    class="page-scroll"
    :content-class="fillContent ? 'page-scroll-content--fill' : undefined"
  >
    <slot />
  </n-scrollbar>
</template>

<style scoped>
.page-scroll {
  height: 100%;
  min-height: 0;
}

.page-scroll > :deep(.n-scrollbar-container) {
  height: 100%;
}

.page-scroll > :deep(.page-scroll-content--fill) {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
</style>
