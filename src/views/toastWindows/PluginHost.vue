<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

let memoryTimer: ReturnType<typeof window.setInterval> | null = null

async function reportMemory() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  if (!memory) return
  await invoke('plugin_report_memory', { bytes: memory.usedJSHeapSize })
}

onMounted(async () => {
  memoryTimer = window.setInterval(() => {
    void reportMemory().catch((error) => console.warn('[plugin-host] memory report failed', error))
  }, 15_000)
  void reportMemory().catch(() => {})

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

onBeforeUnmount(() => {
  if (memoryTimer !== null) window.clearInterval(memoryTimer)
})
</script>

<template>
  <div aria-hidden="true" />
</template>
