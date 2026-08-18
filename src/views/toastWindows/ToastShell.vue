<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

const route = useRoute()

const needsTransparentBg = computed(() => {
  return route.path === '/reminder-fullscreen' || route.path === '/reminder-toast'
})

watch(needsTransparentBg, (val) => {
  document.documentElement.classList.toggle('reminder-transparent', val)
}, { immediate: true })
</script>

<template>
  <RouterView />
</template>

<style>
html.reminder-transparent,
html.reminder-transparent body,
html.reminder-transparent #app {
  background: transparent !important;
}
</style>
