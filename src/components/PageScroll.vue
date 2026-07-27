<script setup lang="ts">
import { NScrollbar } from 'naive-ui'
</script>

<template>
  <n-scrollbar class="page-scroll">
    <slot />
  </n-scrollbar>
</template>

<style scoped>
.page-scroll {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.page-scroll > :deep(.n-scrollbar-container) {
  height: 100%;
}
</style>
