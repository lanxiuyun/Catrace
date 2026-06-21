<script setup lang="ts">
defineProps<{
  title: string
  desc?: string
}>()
</script>

<template>
  <div class="setting-row">
    <div class="setting-meta">
      <div class="setting-title">{{ title }}</div>
      <div v-if="desc" class="setting-desc">{{ desc }}</div>
    </div>
    <div class="setting-control">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.setting-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0.625rem 0;
}

.setting-meta {
  flex: 0 1 auto;
  min-width: 0;
  max-width: calc(100% - 4rem);
}

.setting-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 0;
  overflow-wrap: break-word;
}

.setting-desc {
  font-size: 0.75rem;
  color: #8B7AAB;
  line-height: 1.5;
  overflow-wrap: break-word;
}

.setting-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}
</style>
