const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args)
const INTERVAL_MS = 10_000

async function tick() {
  const activity = await invoke('plugin_get_activity')
  const previous = await invoke('plugin_storage_get', { key: 'tickCount' })
  const count = Number(previous || 0) + 1
  await invoke('plugin_storage_set', { key: 'tickCount', value: count })
  await invoke('plugin_log', {
    level: 'info',
    message: 'timer tick',
    data: { count, active: activity.active },
  })
  await invoke('plugin_publish_event', {
    event: {
      eventType: 'demo-timer.tick',
      kind: 'demo-timer',
      title: 'Demo Timer',
      body: `Background trigger #${count}; currently ${activity.active ? 'active' : 'inactive'}`,
      dedupeKey: 'demo-timer:tick',
      payload: { count, activity },
    },
  })
}

await invoke('plugin_log', { level: 'info', message: 'background loaded' })
setInterval(() => {
  tick().catch((error) => console.error('[demo-timer] tick failed', error))
}, INTERVAL_MS)
