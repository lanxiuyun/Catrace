import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { create } from 'zustand'
import ts from 'typescript'

// Exercise the real TypeScript modules; replace all Tauri, DOM and persistent I/O.
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (path) => {
  const result = ts.transpileModule(source(path), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.equal(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0)
  return result.outputText
}
const quiet = () => ({ log() {}, info() {}, warn() {}, error() {} })
const evaluate = (path, dependencies = {}, globals = {}) => {
  const exports = {}
  runInNewContext(compile(path), {
    exports,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id} in ${path}`)
      return dependencies[id]
    },
    console: quiet(),
    ...globals,
  }, { filename: path })
  return exports
}
const shell = () => evaluate('src/app/store.ts', { zustand: { create } })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const eventBus = () => {
  const listeners = new Map()
  const emitted = []
  const dispatch = (name, payload) => {
    for (const callback of listeners.get(name) ?? []) callback({ payload })
  }
  return {
    listeners, emitted, dispatch,
    async listen(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
      return () => listeners.get(name)?.delete(callback)
    },
    async emit(name, payload) { emitted.push([name, payload]); dispatch(name, payload) },
  }
}
const dom = () => ({ documentElement: {
  lang: '', attrs: {},
  setAttribute(name, value) { this.attrs[name] = value },
  classList: { add() {} },
} })

const handle = (name, options = {}) => ({
  manifest: { name, version: '1', displayName: name, description: '', events: [`kind:${name}`, `${name}.tick`] },
  onEvent() {},
  ...options,
})

test('registry uses immutable maps and React components, retaining lookup and surface contracts', () => {
  const registry = evaluate('src/stores/pluginRegistry.ts', { zustand: { create } }).usePluginRegistry
  const previous = registry.getState().pluginMap
  const Card = () => null
  const Settings = () => null
  registry.getState().register(handle('timer', { external: true, enabled: true, CardComponent: Card, SettingsComponent: Settings }))
  assert.notEqual(registry.getState().pluginMap, previous)
  assert.equal(previous.size, 0)
  assert.equal(registry.getState().getPluginForKind('timer.future').manifest.name, 'timer')
  assert.equal(registry.getState().getCardComponent('timer'), Card)
  assert.equal(registry.getState().hasSettingsPlugins, true)
  assert.equal(registry.getState().getSettingsPlugins().length, 1)
  registry.getState().register(handle('timer', { external: true, enabled: false, SettingsComponent: Settings, settingsSurface: 'plugins' }))
  assert.equal(registry.getState().hasSettingsPlugins, false)
  assert.equal(registry.getState().getSettingsPlugins('plugins').length, 1)
  assert.equal(registry.getState().enabledKinds().length, 0)
  assert.equal(registry.getState().listExternalNames()[0], 'timer')
  registry.getState().unregister('timer')
  assert.equal(registry.getState().getPluginForKind('timer.tick'), undefined)
})

const busEvent = (id, status = 'active', revision = 1) => ({
  id, event_type: 'timer.tick', kind: 'timer', status, revision,
  created_at: Number(id) || 1, updated_at: Number(id) || 1,
})
const eventHub = (listen, invoke = async () => []) => evaluate('src/stores/eventHub.ts', {
  zustand: { create },
  '@tauri-apps/api/event': { listen },
  '@tauri-apps/api/core': { invoke },
}).useEventHub

test('event hub coalesces startup, ignores old revisions and bounds only resolved history', async () => {
  let receive, calls = 0, disposed = 0
  const hub = eventHub(async (_name, callback) => {
    calls++; receive = callback
    return () => disposed++
  })
  await Promise.all([hub.getState().startListening(), hub.getState().startListening()])
  assert.equal(calls, 1)
  let delivered = 0
  const off = hub.getState().on('kind:timer', () => delivered++)
  receive({ payload: busEvent('active', 'active', 2) })
  receive({ payload: busEvent('active', 'resolved', 1) })
  assert.equal(hub.getState().getById('active').status, 'active')
  assert.equal(delivered, 1)
  for (let id = 0; id < 155; id++) receive({ payload: busEvent(String(id), 'resolved') })
  assert.equal(hub.getState().resolvedEvents.length, 150)
  assert.equal(hub.getState().activeEvents.length, 1)
  hub.getState().consume('active')
  assert.equal(hub.getState().activeEvents.length, 0)
  off(); hub.getState().stopListening()
  assert.equal(disposed, 1)
})

test('event hub retries failed registration and disposes a pending listener after stop', async () => {
  let fail = true
  const pending = deferred()
  let disposed = 0, hydrated = 0
  const hub = eventHub(async () => {
    if (fail) throw new Error('listen denied')
    await pending.promise
    return () => disposed++
  }, async () => { hydrated++; return [] })
  await assert.rejects(hub.getState().startListening(), /listen denied/)
  fail = false
  const start = hub.getState().startListening()
  hub.getState().stopListening()
  pending.resolve()
  await start
  assert.equal(disposed, 1)
  assert.equal(hydrated, 0)
})

const localeModule = (state, bus, document, api) => evaluate('src/app/i18n.ts', {
  react: { useCallback: (callback) => callback },
  '@tauri-apps/api/event': bus,
  '../api/tauri': api,
  '../utils/locale': { detectDefaultLocale: () => 'zh-CN' },
  '../i18n/locales/zh-CN': { default: { greeting: '你好 {name}', onlyChinese: 'fallback' } },
  '../i18n/locales/en-US': { default: { greeting: 'Hello {name}' } },
  './store': state,
}, { document })

test('locale owns zustand state, falls back and interpolates, and synchronizes another WebView', async () => {
  const bus = eventBus(), a = shell(), b = shell(), firstDom = dom(), secondDom = dom()
  let saved = 'en-US', reject = false
  const api = {
    getLocale: async () => saved,
    setLocale: async (locale) => { if (reject) throw new Error('save denied'); saved = locale },
  }
  const first = localeModule(a, bus, firstDom, api), second = localeModule(b, bus, secondDom, api)
  await Promise.all([first.initLocale(), second.initLocale()])
  assert.equal(firstDom.documentElement.lang, 'en-US')
  assert.equal(first.translate('en-US', 'greeting', { name: 'Catrace' }), 'Hello Catrace')
  assert.equal(first.translate('en-US', 'onlyChinese'), 'fallback')
  assert.equal(first.translate('en-US', 'unknown'), 'unknown')
  await first.setAppLocale('zh-CN')
  assert.equal(saved, 'zh-CN')
  assert.equal(a.useShellStore.getState().locale, 'zh-CN')
  assert.equal(b.useShellStore.getState().locale, 'zh-CN')
  assert.equal(secondDom.documentElement.lang, 'zh-CN')
  reject = true
  await assert.rejects(first.setAppLocale('en-US'), /save denied/)
  assert.equal(a.useShellStore.getState().locale, 'zh-CN')
  bus.dispatch('catrace-locale-changed', { locale: 'invalid' })
  assert.equal(b.useShellStore.getState().locale, 'zh-CN')
})

test('locale initialization cannot overwrite a newer cross-window change with an old read', async () => {
  const state = shell(), bus = eventBus(), document = dom(), pending = deferred(), reading = deferred()
  const locale = localeModule(state, bus, document, {
    getLocale: async () => { reading.resolve(); return pending.promise },
    setLocale: async () => { throw new Error('unexpected save') },
  })
  const initialization = locale.initLocale()
  await reading.promise
  bus.dispatch('catrace-locale-changed', { locale: 'en-US' })
  pending.resolve('zh-CN')
  await initialization
  assert.equal(state.useShellStore.getState().locale, 'en-US')
})

test('theme retains theme.mode, system preference changes, DOM updates and cross-window events', async () => {
  const state = shell(), bus = eventBus(), document = dom(), writes = []
  let changed, loads = 0, saves = 0
  const theme = evaluate('src/composables/useTheme.ts', {
    '@tauri-apps/plugin-store': { load: async () => {
      loads++
      return { get: async (key) => { assert.equal(key, 'theme.mode'); return 'system' }, set: async (...args) => writes.push(args), save: async () => saves++ }
    } },
    '@tauri-apps/api/event': bus,
    '../app/store': state,
  }, { document, window: { matchMedia: () => ({ matches: true, addEventListener: (_name, callback) => { changed = callback } }) } })
  await Promise.all([theme.initTheme(), theme.initTheme()])
  assert.equal(loads, 1)
  assert.equal(state.useShellStore.getState().resolvedTheme, 'dark')
  changed({ matches: false })
  assert.equal(state.useShellStore.getState().resolvedTheme, 'light')
  await theme.setThemeMode('dark')
  assert.equal(writes.at(-1)[0], 'theme.mode')
  assert.equal(writes.at(-1)[1], 'dark')
  assert.equal(saves, 1)
  assert.equal(document.documentElement.attrs['data-theme'], 'dark')
  bus.dispatch('catrace-theme-changed', { mode: 'light' })
  assert.equal(state.useShellStore.getState().themeMode, 'light')
  assert.equal(document.documentElement.attrs['data-theme'], 'light')
})

const startupModule = (mode, calls, bus) => evaluate('src/app/bootstrap.ts', {
  '@tauri-apps/api/core': { invoke: async () => {} },
  '@tauri-apps/api/event': bus,
  '@tauri-apps/api/window': { getCurrentWindow: () => ({ label: 'plugin-bg-demo' }) },
  '../api/tauri': { logFrontend: async () => {} },
  '../composables/useTheme': { initTheme: async () => calls.push('theme') },
  './i18n': { initLocale: async () => calls.push('locale') },
  '../plugins/registerBuiltins': { registerBuiltinPlugins: () => calls.push('builtins') },
  '../plugins/loadExternalPlugins': { loadExternalPlugins: async (options) => { calls.push(options?.force ? 'force-load' : 'load'); return [] } },
  '../plugins/pluginApi': { ensurePluginLogConsole: () => calls.push('host-console'), installPluginConsoleForwarding: (id) => calls.push(`plugin-console:${id}`) },
  '../stores/eventHub': { useEventHub: { getState: () => ({ startListening: async () => calls.push('hub') }) } },
  '../components/pluginHostCardCache': { clearPluginHostCardCache: () => calls.push('clear') },
  './preflight': { detectWindowMode: () => mode },
}, { document: dom(), window: { addEventListener() {} } })

test('plugin-host startup keeps identity logging and never reads host locale or theme settings', async () => {
  const calls = []
  await startupModule('plugin-host', calls, eventBus()).bootstrap()
  assert.deepEqual(calls, ['plugin-console:demo'])
})

test('main startup loads external plugins without a migration gate and subscribes to persisted changes', async () => {
  const calls = [], bus = eventBus()
  await startupModule('main', calls, bus).bootstrap()
  assert.ok(calls.includes('builtins'))
  assert.ok(calls.includes('locale'))
  assert.ok(calls.includes('theme'))
  assert.ok(calls.includes('hub'))
  assert.ok(calls.includes('load'))
  await bus.emit('plugin-enabled-changed', {})
  await Promise.resolve()
  assert.ok(calls.includes('force-load'))
  assert.ok(calls.includes('clear'))
})
