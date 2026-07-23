<script setup lang="ts">
import { onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

onMounted(async () => {
  try {
    const source = await invoke<string>('get_plugin_background_source')
    const blob = new Blob([source], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    try {
      await import(/* @vite-ignore */ url)
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (error) {
    console.error('[plugin-host] failed to load background', error)
  }
})
</script>

<template>
  <div aria-hidden="true" />
</template>
