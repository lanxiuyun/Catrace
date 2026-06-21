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
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0.625rem 0;
}

.setting-row.align-start {
  align-items: flex-start;
}

.setting-meta {
  width: 13rem;
  flex-shrink: 0;
  min-width: 0;
}

.setting-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 0;
}

.setting-desc {
  font-size: 0.75rem;
  color: #8B7AAB;
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
