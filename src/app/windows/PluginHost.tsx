import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ensurePluginRuntime } from '../../plugins/pluginRuntime'
import { wrapPluginSource } from '../../plugins/pluginApi'

async function reportMemory() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  if (memory) await invoke('plugin_report_memory', { bytes: memory.usedJSHeapSize })
}

/** One hidden window owns one plugin background ESM and its side effects. */
export default function PluginHost() {
  useEffect(() => {
    let disposed = false
    let unlistenResolved: UnlistenFn | null = null
    let blobUrl: string | null = null
    const releaseBlob = () => {
      if (blobUrl !== null) URL.revokeObjectURL(blobUrl)
      blobUrl = null
    }
    const memoryTimer = window.setInterval(() => {
      void reportMemory().catch((error) => console.warn('[plugin-host] memory report failed', error))
    }, 15_000)
    void reportMemory().catch(() => {})

    // Background modules retain the public DOM event protocol, independently of their UI runtime.
    void listen<Record<string, unknown>>('catrace:plugin-event-resolved', (event) => {
      if (!disposed) window.dispatchEvent(new CustomEvent('catrace:plugin-event-resolved', { detail: event.payload }))
    }).then((unlisten) => {
      if (disposed) unlisten()
      else unlistenResolved = unlisten
    }).catch((error) => console.warn('[plugin-host] resolved listener failed', error))

    void (async () => {
      try {
        ensurePluginRuntime()
        const pluginId = getCurrentWindow().label.replace(/^plugin-bg-/, '')
        const source = await invoke<string>('get_plugin_background_source')
        if (disposed) return
        blobUrl = URL.createObjectURL(new Blob([wrapPluginSource(pluginId, source)], { type: 'text/javascript' }))
        try {
          // Existing non-UI background modules run as ordinary ESM side effects. Do not invent
          // start/cleanup calls: the plugin window's destruction owns their resource lifetime.
          await import(/* @vite-ignore */ blobUrl)
        } finally { releaseBlob() }
      } catch (error) { console.error('[plugin-host] failed to load background', error) }
    })()

    return () => {
      disposed = true
      window.clearInterval(memoryTimer)
      unlistenResolved?.()
      unlistenResolved = null
      releaseBlob()
    }
  }, [])

  return <div aria-hidden="true" />
}
