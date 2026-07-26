<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

let memoryTimer: ReturnType<typeof window.setInterval> | null = null
let unlistenResolved: UnlistenFn | null = null

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

  // Forward bus resolve outcomes into the bg module as DOM CustomEvents.
  void listen<Record<string, unknown>>('catrace:plugin-event-resolved', (event) => {
    window.dispatchEvent(
      new CustomEvent('catrace:plugin-event-resolved', { detail: event.payload }),
    )
  }).then((unlisten) => {
    unlistenResolved = unlisten
  })

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
  unlistenResolved?.()
  unlistenResolved = null
})
</script>

<template>
  <div aria-hidden="true" />
</template>
