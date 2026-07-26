<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="plugin-section">
    <h3 class="section-title">{{ title }}</h3>
    <div class="section-card">
      <p v-if="description" class="section-desc">{{ description }}</p>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.plugin-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #475569;
  letter-spacing: 0.02rem;
}

.section-card {
  background: #fff;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.875rem;
  padding: 0.75rem 1rem;
  box-shadow: 0 0.0625rem 0.125rem rgba(15, 23, 42, 0.03);
}

.section-desc {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: #94a3b8;
  line-height: 1.4;
}
</style>
