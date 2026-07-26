<script setup lang="ts">
</script>

<template>
  <div class="plugin-panel-shell">
    <div class="panel-content">
      <div class="panel-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-panel-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.panel-content {
  flex: 1;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  max-width: 64rem;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 1.5rem 2rem 2rem;
}
</style>
