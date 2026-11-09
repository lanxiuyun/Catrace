import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

// Real source modules, mocked Tauri/clock/DOM only. No browser, AppData, or native window is used.
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const deferred = () => {
  let resolvePromise
  const promise = new Promise((resolve) => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve() }

function harness(overrides = {}) {
  const timeouts = new Map(), intervals = new Map(), frames = new Map()
  let id = 0, now = 0
  const calls = { sizes: [], removals: [], additions: [], resolves: [], rest: [], listeners: [], closed: [], unlistened: [] }
  const domListeners = new Map()
  const api = {
    getReminderData: async () => null,
    getToastDebugMode: async () => false,
    closeReminderWindow: async (...args) => { calls.closed.push(args) },
    prepareWindowActivation: async () => {},
    setWindowActiveMode: async () => {},
    getActiveEvents: async () => [],
    resolveEvent: async (...args) => { calls.resolves.push(args) },
    resolveEventAction: async (...args) => { calls.resolves.push(args) },
    setToastContentSize: async (...args) => { calls.sizes.push(args) },
    getActivitySnapshot: async () => ({ count: 0, media_active: false, fullscreen_active: false }),
    dismissRestTimer: async () => {},
    ...overrides,
  }
  const registry = { getPluginForKind: () => undefined, getPlugin: () => undefined }
  const modules = new Map()
  const load = (name) => {
    const path = resolve(here, name.endsWith('.ts') ? name : `${name}.ts`)
    if (modules.has(path)) return modules.get(path)
    const exports = {}
    modules.set(path, exports)
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    runInNewContext(output, {
      exports,
      require(specifier) {
        if (specifier.endsWith('/api/tauri')) return api
        if (specifier.endsWith('/stores/pluginRegistry')) return { usePluginRegistry: { getState: () => registry } }
        if (specifier === '@tauri-apps/api/event') return {
          listen: async (name, listener) => {
            calls.listeners.push([name, listener])
            return api.listen ? api.listen(name, listener) : () => calls.unlistened.push(name)
          },
        }
        if (specifier === '@tauri-apps/api/webviewWindow') return { getCurrentWebviewWindow: () => ({ close: async () => calls.closed.push(['fallback']) }) }
        if (specifier === '@tauri-apps/plugin-process') return { relaunch: async () => {} }
        if (specifier.endsWith('/plugins/loadExternalPlugins')) return { loadExternalPlugins: api.loadExternalPlugins || (async () => []) }
        if (specifier.endsWith('/components/pluginHostCardCache')) return { clearPluginHostCardCache() {} }
        if (specifier === 'zustand/vanilla') return require(specifier)
        if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
        throw new Error(`Unexpected dependency ${specifier}`)
      },
      console: { info() {}, warn() {}, error() {} },
      Date: { now: () => now }, performance: { now: () => now },
      setTimeout(callback, delay) { const token = ++id; timeouts.set(token, { callback, delay }); return token },
      clearTimeout(token) { timeouts.delete(token) },
      setInterval(callback, delay) { const token = ++id; intervals.set(token, { callback, delay }); return token },
      clearInterval(token) { intervals.delete(token) },
      requestAnimationFrame(callback) { const token = ++id; frames.set(token, callback); return token },
      cancelAnimationFrame(token) { frames.delete(token) },
      ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
      document: {
        addEventListener(name, callback) { domListeners.set(name, callback) },
        removeEventListener(name) { domListeners.delete(name) },
      },
    }, { filename: path })
    return exports
  }
  const { items, store } = load('toastState').createToastState()
  const nextFrame = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback() }
  return { load, items, store, api, registry, calls, timeouts, intervals, frames, nextFrame, domListeners,
    advance(ms) { now += ms } }
}

const item = (patch = {}) => ({
  id: 1, kind: 'sdk', title: '', body: '', boundary: 0, visible: true, isHovered: false,
  remainingMs: 8000, totalMs: 8000, closeTimer: null, lastStartAt: 0, ...patch,
})
const event = (patch = {}) => ({
  id: 'event-1', event_type: 'sdk.test', source: { type: 'sdk' }, kind: 'sdk',
  display_mode: 'toast', level: 'info', title: 'First', body: '', actions: [],
  payload: {}, status: 'active', revision: 1, ...patch,
})
function bus(h) {
  return h.load('busEvents').createToastBusEvents({
    items: h.items,
    startTimer(value) { value.closeTimer = 999 },
    stopTimer(value) { value.closeTimer = null },
    addNotification(value) { h.calls.additions.push(value) },
    removeNotification(...args) { h.calls.removals.push(args) },
    updateRestTimer(value) { h.calls.rest.push(value) },
    scheduleWindowResize() {},
  })
}

test('hover pauses remaining time, resumes without changing CSS total, and keeps one hovered card', () => {
  const h = harness()
  const one = item(), two = item({ id: 2 })
  h.items.current = [one, two]
  const timers = h.load('closeTimer').createToastCloseTimer(h.items, () => {})
  timers.startTimer(one)
  h.advance(2100)
  timers.handleMouseEnter(one)
  assert.equal(one.remainingMs, 5900)
  assert.equal(one.totalMs, 8000)
  assert.equal(h.timeouts.size, 0)
  timers.handleMouseEnter(two)
  assert.equal(one.isHovered, false)
  assert.equal(two.isHovered, true)
  assert.equal(h.timeouts.get(one.closeTimer).delay, 5900)
  timers.stopAll()
  assert.equal(h.timeouts.size, 0)
})

test('zero-remaining hover leave restarts full lifetime; sticky and rest timer never auto-close', () => {
  const h = harness()
  const timers = h.load('closeTimer').createToastCloseTimer(h.items, () => {})
  const exhausted = item({ remainingMs: 0, isHovered: true })
  timers.handleMouseLeave(exhausted)
  assert.equal(h.timeouts.get(exhausted.closeTimer).delay, 8000)
  const sticky = item({ id: 2, sticky: true }), rest = item({ id: 3, kind: 'rest-timer' })
  timers.handleMouseEnter(sticky); timers.handleMouseLeave(sticky)
  timers.handleMouseEnter(rest); timers.handleMouseLeave(rest)
  assert.equal(h.timeouts.size, 1)
})

test('plugin upsert retains card identity and hovered timeout, sticky actions roundtrip until dismiss', () => {
  const h = harness()
  const current = item({ pluginId: 'chat', eventId: 'old', dedupeKey: 'chat:1', isHovered: true, remainingMs: 3200 })
  h.items.current = [current]
  const events = bus(h)
  events.handleBusEvent(event({ id: 'new', kind: 'chat', source: { type: 'plugin', name: 'chat' }, dedupe_key: 'chat:1' }))
  assert.equal(h.items.current[0], current)
  assert.equal(current.id, 1)
  assert.equal(current.eventId, 'new')
  assert.equal(current.remainingMs, 3200)
  assert.equal(current.closeTimer, null)
  assert.equal(h.calls.additions.length, 0)
  events.handleBusEvent(event({ id: 'sticky', kind: 'chat', source: { type: 'plugin', name: 'chat' }, dedupe_key: 'chat:1', sticky: true }))
  assert.equal(current.totalMs, 0)
  events.handleBusEvent(event({ id: 'sticky', status: 'resolved', resolution: { kind: 'action', action_id: 'echo' } }))
  assert.equal(h.calls.removals.length, 0)
  events.handleBusEvent(event({ id: 'sticky', status: 'resolved', resolution: { kind: 'action', action_id: 'dismiss' } }))
  assert.deepEqual(h.calls.removals, [[1, true]])
})

test('superseded keeps card; plugin payload dismiss removes by dedupe; standalone style is preserved', () => {
  const h = harness()
  h.items.current = [item({ pluginId: 'chat', eventId: 'old', dedupeKey: 'chat:1' })]
  const events = bus(h)
  events.handleBusEvent(event({ id: 'old', status: 'resolved', resolution: { kind: 'superseded' } }))
  assert.equal(h.calls.removals.length, 0)
  events.handleBusEvent(event({ id: 'next', kind: 'chat', source: { type: 'plugin', name: 'chat' }, dedupe_key: 'chat:1', payload: { dismiss: true } }))
  assert.deepEqual(h.calls.removals, [[1, true]])
  events.handleBusEvent(event({ id: 'standalone', kind: 'other', source: { type: 'plugin', name: 'other' }, payload: { toastStyle: 'standalone' } }))
  assert.equal(h.calls.additions[0].toastStyle, 'standalone')
  events.dispose()
  events.handleBusEvent(event({ id: 'late' }))
  assert.equal(h.calls.additions.length, 1)
})

test('rest timer rising revisions route to upsert and forwarded notification retains actions', () => {
  const h = harness(), events = bus(h)
  events.handleBusEvent(event({ kind: 'rest-timer', payload: { rest_streak: 1, break_minutes: 5 } }))
  events.handleBusEvent(event({ kind: 'rest-timer', revision: 2, payload: { rest_streak: 2, break_minutes: 5 } }))
  assert.equal(h.calls.rest.length, 2)
  assert.equal(h.calls.rest[1].rest_streak, 2)
  const actions = [{ id: 'reply', label: 'Reply' }]
  events.handleBusEvent(event({ id: 'notification', kind: 'notification', actions,
    payload: { app_name: 'Mail', icon_data_url: 'data:image/png;base64,x', body_clickable: true, auto_hide_ms: 10000 } }))
  assert.equal(h.calls.additions[0].appName, 'Mail')
  assert.equal(h.calls.additions[0].bodyClickable, true)
  assert.equal(h.calls.additions[0].autoHideMs, 10000)
  assert.equal(h.calls.additions[0].notificationActions, actions)
})

test('rest timer polls baseline, ignores fullscreen, and delays activity removal by four seconds', async () => {
  const h = harness()
  let snapshot = { count: 10, media_active: false, fullscreen_active: false }
  h.api.getActivitySnapshot = async () => snapshot
  const rest = h.load('restTimer').createRestTimerCard({
    items: h.items, nextId: () => 1, t: (key) => key, scheduleWindowResize() {},
    removeNotification: (...args) => h.calls.removals.push(args),
    markEventResolved: (...args) => h.calls.resolves.push(args), markEventSeen() {},
  })
  rest.updateRestTimer({ break_minutes: 5, rest_start_ts: 0, rest_streak: 1, remaining_minutes: 4, is_complete: false, eventId: 'rest' })
  await flush()
  assert.equal(h.intervals.size, 1)
  snapshot = { count: 20, media_active: true, fullscreen_active: true }
  await [...h.intervals.values()][0].callback()
  await flush()
  assert.equal(h.timeouts.size, 0)
  snapshot = { count: 0, media_active: false, fullscreen_active: false }
  await [...h.intervals.values()][0].callback()
  await flush()
  assert.equal(h.timeouts.size, 0)
  snapshot = { count: 1, media_active: false, fullscreen_active: false }
  await [...h.intervals.values()][0].callback()
  await flush()
  assert.equal(h.intervals.size, 0)
  const pending = [...h.timeouts.values()][0]
  assert.equal(pending.delay, 4000)
  pending.callback()
  assert.deepEqual(h.calls.removals, [[1, true]])
  rest.dispose()
})

test('unmount during rest snapshot initialization cannot resurrect a polling interval', async () => {
  const pending = deferred(), h = harness({ getActivitySnapshot: () => pending.promise })
  const rest = h.load('restTimer').createRestTimerCard({
    items: h.items, nextId: () => 1, t: (key) => key, scheduleWindowResize() {},
    removeNotification() {}, markEventResolved() {}, markEventSeen() {},
  })
  rest.updateRestTimer({ break_minutes: 5, rest_start_ts: 0, rest_streak: 0, remaining_minutes: 5, is_complete: false })
  rest.dispose()
  pending.resolve({ count: 0 })
  await flush()
  assert.equal(h.intervals.size, 0)
  assert.equal(h.frames.size, 0)
})

test('content resize is single-flight, follows latest height, and never reports empty padding', async () => {
  const first = deferred(), h = harness()
  let count = 0
  h.api.setToastContentSize = (...args) => { h.calls.sizes.push(args); return ++count === 1 ? first.promise : Promise.resolve() }
  const rootRef = { current: { scrollWidth: 392, style: {} } }
  const stackRef = { current: { scrollHeight: 117 } }
  let empty = false, animating = false
  const resize = h.load('windowResize').createToastWindowResize({ rootRef, stackRef, isAnimating: () => animating, isEmpty: () => empty })
  resize.scheduleWindowResize(); h.nextFrame()
  stackRef.current.scrollHeight = 280
  resize.scheduleWindowResize(); h.nextFrame()
  assert.equal(h.calls.sizes.length, 1)
  first.resolve(); await flush()
  assert.deepEqual(h.calls.sizes, [[392, 117], [392, 280]])
  animating = true
  stackRef.current.scrollHeight = 80
  resize.scheduleWindowResize(); h.nextFrame(); await flush()
  assert.equal(h.calls.sizes.length, 2)
  empty = true; animating = false
  resize.scheduleWindowResize(); h.nextFrame(); await flush()
  assert.equal(h.calls.sizes.length, 2)
  resize.detach()
  assert.equal(h.frames.size, 0)
})

test('controller keeps class-only exit for 250ms and disposes all native/listener/timer ownership', async () => {
  const h = harness()
  const controller = h.load('controller').createToastController(
    { current: { scrollWidth: 392, style: {} } },
    { current: { scrollHeight: 117, scrollTop: 0, clientHeight: 117 } },
    (key) => key,
  )
  await controller.mount()
  assert.deepEqual(h.calls.listeners.map(([name]) => name), ['catrace-toast-debug-changed', 'catrace:reload-external-plugins', 'catrace:event'])
  assert.equal(h.domListeners.size, 2)
  controller.addNotification({ kind: 'sdk', eventId: 'sdk', title: 'Toast' })
  h.nextFrame()
  const visible = controller.store.getState().notifications[0]
  assert.equal(visible.visible, true)
  controller.removeNotification(visible.id, true)
  assert.equal(visible.leaving, true)
  assert.equal(controller.store.getState().notifications.length, 1)
  const leave = [...h.timeouts.entries()].find(([, timer]) => timer.delay === 250)
  assert.ok(leave)
  h.timeouts.delete(leave[0]); leave[1].callback()
  assert.equal(controller.store.getState().notifications.length, 0)
  await flush()
  assert.deepEqual(h.calls.closed, [['reminder-toast']])
  controller.dispose()
  assert.equal(h.domListeners.size, 0)
  assert.equal(h.calls.unlistened.length, 3)
  assert.equal(h.timeouts.size, 0)
  assert.equal(h.intervals.size, 0)
  assert.equal(h.frames.size, 0)
})

test('listener registration finishing after unmount immediately unregisters and never hydrates', async () => {
  const registration = deferred()
  let cleanup = 0, hydration = 0
  const h = harness({
    listen: () => registration.promise,
    getActiveEvents: async () => { ++hydration; return [] },
  })
  const controller = h.load('controller').createToastController({ current: null }, { current: null }, (key) => key)
  const mounting = controller.mount()
  await flush()
  assert.equal(h.calls.listeners.length, 1)
  controller.dispose()
  registration.resolve(() => { ++cleanup })
  await mounting
  assert.equal(cleanup, 1)
  assert.equal(hydration, 0)
  assert.equal(h.domListeners.size, 0)
})

test('bottom following preserves readers scroll and resets for an empty/new stack', () => {
  const h = harness()
  const stack = { scrollHeight: 1000, scrollTop: 100, clientHeight: 400 }
  let count = 3
  const scroll = h.load('stackScroll').createToastStackScroll({ current: stack }, () => count)
  scroll.handleStackScroll(); scroll.scrollStackToBottom()
  assert.equal(stack.scrollTop, 100)
  scroll.pinToBottom(); scroll.scrollStackToBottom()
  assert.equal(stack.scrollTop, 1000)
  count = 1; scroll.scrollStackToBottom()
  assert.equal(stack.scrollTop, 0)
})
