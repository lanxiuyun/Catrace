import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Compile the real modules, but supply every I/O dependency from this test.
// No Tauri runtime, AppData, persistent Store, network, browser, or dev server is used.
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const sourceModule = compile('../src/app/pages/plugins/pluginRepositorySource.ts')
const catalogModule = compile('../src/app/pages/plugins/usePluginCatalog.ts')
const OFFICIAL = 'lanxiuyun/catrace-plugin'
const CUSTOM = 'example/custom-plugins'
const KEY = 'plugin_repository'
const OLD_SHA = '1'.repeat(40)
const NEW_SHA = '2'.repeat(40)
const catalog = (repository, commit = OLD_SHA) => ({
  repository, commit, plugins: [{ id: 'timer', name: 'Timer', version: '1', description: '' }],
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

// State and refs persist across manual renders. Effects/callbacks respect dependencies,
// so rendering a hook snapshot does not accidentally restart its mount requests.
function reactHooks() {
  const slots = []
  let cursor = 0
  let effects = []
  const changed = (old, next) => !old || !next || old.length !== next.length || next.some((value, i) => !Object.is(value, old[i]))
  return {
    begin() { cursor = 0 },
    flushEffects() { const pending = effects; effects = []; for (const run of pending) run() },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
    api: {
      useState(initial) {
        const i = cursor++
        if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
        return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }]
      },
      useRef(initial) {
        const i = cursor++
        if (!slots[i]) slots[i] = { current: initial }
        return slots[i]
      },
      useCallback(callback, deps) {
        const i = cursor++
        if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: callback, deps }
        return slots[i].value
      },
      useEffect(effect, deps) {
        const i = cursor++
        if (!slots[i] || changed(slots[i].deps, deps)) {
          const previous = slots[i]
          slots[i] = { deps }
          effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect() })
        }
      },
    },
  }
}

function harness(stored) {
  const hooks = reactHooks()
  const memory = new Map(stored === undefined ? [] : [[KEY, stored]])
  const disk = new Map(memory)
  const state = {
    memory, disk, lists: [], installs: [], storeCalls: [], toasts: [], errors: [], listeners: [],
    onList: async repository => catalog(repository),
    onInstall: async id => ({ id, name: 'Timer', version: '1' }),
    onSave: async () => {},
  }
  const store = {
    async get(key) { state.storeCalls.push(['get', key]); return memory.get(key) },
    async set(key, value) { state.storeCalls.push(['set', key, value]); memory.set(key, value) },
    async delete(key) { state.storeCalls.push(['delete', key]); memory.delete(key) },
    async save() {
      state.storeCalls.push(['save', memory.get(KEY)])
      await state.onSave()
      disk.clear()
      for (const [key, value] of memory) disk.set(key, value)
    },
  }
  const api = {
    DEFAULT_PLUGIN_REPOSITORY: OFFICIAL,
    listPluginCatalog: async () => [],
    listRepositoryPlugins: async repository => {
      state.lists.push(repository)
      return state.onList(repository)
    },
    installRepositoryPlugin: async (...args) => {
      state.installs.push(args)
      return state.onInstall(...args)
    },
    setExternalPluginEnabled: async () => { throw new Error('Unexpected toggle in repository-source test') },
    uninstallExternalPlugin: async () => { throw new Error('Unexpected uninstall in repository-source test') },
  }
  const evaluate = (compiled, dependencies, filename) => {
    const exports = {}
    runInNewContext(compiled, {
      exports,
      require(id) {
        assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id} in ${filename}`)
        return dependencies[id]
      },
      console: { warn: (...args) => state.errors.push(args), error: (...args) => state.errors.push(args) },
    }, { filename })
    return exports
  }
  const settings = evaluate(sourceModule, {
    '../../../api/tauri': api,
    '../../lib/settingsStore': { getSettingsStore: async () => store },
  }, 'pluginRepositorySource.mock.cjs')
  const translate = key => key
  const hook = evaluate(catalogModule, {
    react: hooks.api,
    '@tauri-apps/api/event': {
      listen: async (name, callback) => {
        const listener = { name, callback, disposed: false }
        state.listeners.push(listener)
        return () => { listener.disposed = true }
      },
    },
    '../../../api/tauri': api,
    '../../i18n': { useT: () => translate },
    '../../ui/toast': { showToast: (...args) => state.toasts.push(args) },
    './pluginRepositorySource': settings,
  }, 'usePluginCatalog.mock.cjs')
  const render = () => { hooks.begin(); const value = hook.usePluginCatalog(); hooks.flushEffects(); return value }
  return {
    state, settings,
    get current() { return render() },
    async mount() { render(); await flush(); return render() },
    unmount: hooks.unmount,
  }
}

for (const stored of [undefined, null, '', '   ', 42]) {
  test(`missing or invalid saved source falls back to official (${JSON.stringify(stored)})`, async () => {
    const h = harness(stored)
    assert.equal(await h.settings.readPluginRepository(), OFFICIAL)
    const current = await h.mount()
    assert.equal(current.source, OFFICIAL)
    assert.equal(current.repository.repository, OFFICIAL)
    assert.deepEqual(h.state.lists, [OFFICIAL])
    assert.equal(h.state.storeCalls.some(([action]) => action === 'save'), false)
  })
}

test('saved repository is restored on mount, not silently reset to official', async () => {
  const h = harness(CUSTOM)
  const current = await h.mount()
  assert.equal(current.source, CUSTOM)
  assert.equal(current.repository.repository, CUSTOM)
  assert.deepEqual(h.state.lists, [CUSTOM])
  assert.equal(h.state.disk.get(KEY), CUSTOM)
})

test('source changes only after validation AND Store.save both succeed', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  const oldCatalog = h.current.repository
  const validation = deferred()
  const saving = deferred()
  const nextCatalog = catalog(CUSTOM, NEW_SHA)
  h.state.onList = async () => validation.promise
  h.state.onSave = async () => saving.promise
  const operation = h.current.changeSource('  https://github.com/example/custom-plugins  ')
  await flush()
  assert.equal(h.current.sourceBusy, true)
  assert.equal(h.current.source, OFFICIAL)
  assert.equal(h.current.repository, oldCatalog)
  assert.equal(h.state.memory.get(KEY), OFFICIAL)
  assert.equal(h.state.storeCalls.some(([action]) => action === 'save'), false)
  assert.equal(h.state.lists.at(-1), 'https://github.com/example/custom-plugins')
  validation.resolve(nextCatalog)
  await flush()
  assert.equal(h.state.memory.get(KEY), CUSTOM)
  assert.equal(h.state.disk.get(KEY), OFFICIAL)
  assert.equal(h.current.source, OFFICIAL)
  assert.equal(h.current.repository, oldCatalog)
  saving.resolve()
  await operation
  assert.equal(h.current.source, CUSTOM)
  assert.equal(h.current.repository, nextCatalog)
  assert.equal(h.state.disk.get(KEY), CUSTOM)
  assert.equal(h.current.sourceBusy, false)
})

test('backend validation failure retains old source/catalog and never writes Store', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  const before = h.current.repository
  h.state.onList = async () => { throw new Error('invalid repository') }
  await assert.rejects(h.current.changeSource('bad/source'), /invalid repository/)
  assert.equal(h.current.source, OFFICIAL)
  assert.equal(h.current.repository, before)
  assert.equal(h.current.sourceBusy, false)
  assert.equal(h.state.memory.get(KEY), OFFICIAL)
  assert.equal(h.state.disk.get(KEY), OFFICIAL)
  assert.equal(h.state.storeCalls.some(([action]) => action === 'set' || action === 'save'), false)
})

test('save failure retains old catalog and restores both in-memory and persisted source', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  const before = h.current.repository
  let attempts = 0
  h.state.onSave = async () => { if (++attempts === 1) throw new Error('disk full') }
  await assert.rejects(h.current.changeSource(CUSTOM), /disk full/)
  assert.equal(h.current.source, OFFICIAL)
  assert.equal(h.current.repository, before)
  assert.equal(h.current.sourceBusy, false)
  assert.equal(h.state.memory.get(KEY), OFFICIAL)
  assert.equal(h.state.disk.get(KEY), OFFICIAL)
  assert.deepEqual(h.state.storeCalls.filter(([action]) => action === 'save'), [['save', CUSTOM], ['save', OFFICIAL]])
  assert.equal(h.state.toasts.some(([message]) => message === 'pluginMarket.sourceSaved'), false)
})

test('failed first-ever save deletes the new in-memory key rather than leaving an autoSave trap', async () => {
  const h = harness()
  await h.mount()
  let attempts = 0
  h.state.onSave = async () => { if (++attempts === 1) throw new Error('cannot save') }
  await assert.rejects(h.current.changeSource(CUSTOM), /cannot save/)
  assert.equal(h.state.memory.has(KEY), false)
  assert.equal(h.state.disk.has(KEY), false)
  assert.ok(h.state.storeCalls.some(([action, key]) => action === 'delete' && key === KEY))
  assert.equal(h.current.source, OFFICIAL)
})

test('even if rollback save also fails, in-memory source is restored and original error propagates', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  h.state.onSave = async () => { throw new Error('persistent save failure') }
  await assert.rejects(h.current.changeSource(CUSTOM), /persistent save failure/)
  assert.equal(h.state.memory.get(KEY), OFFICIAL)
  assert.equal(h.state.disk.get(KEY), OFFICIAL)
  assert.equal(h.current.source, OFFICIAL)
  assert.equal(h.state.errors.length, 1)
})

test('restoring official source persists it and survives a later catalog refresh', async () => {
  const h = harness(CUSTOM)
  await h.mount()
  await h.current.changeSource(OFFICIAL)
  assert.equal(h.current.source, OFFICIAL)
  assert.equal(h.state.disk.get(KEY), OFFICIAL)
  await h.current.refreshRemote()
  assert.equal(h.state.lists.at(-1), OFFICIAL)
  assert.equal(h.current.repository.repository, OFFICIAL)
})

for (const lateFailure of [false, true]) {
  test(`old source refresh cannot overwrite switched source (${lateFailure ? 'late rejection' : 'late success'})`, async () => {
    const h = harness(OFFICIAL)
    await h.mount()
    const oldRequest = deferred()
    h.state.onList = async repository => repository === OFFICIAL ? oldRequest.promise : catalog(repository, NEW_SHA)
    const refreshing = h.current.refreshRemote()
    await flush()
    await h.current.changeSource(CUSTOM)
    if (lateFailure) oldRequest.reject(new Error('old source timeout'))
    else oldRequest.resolve(catalog(OFFICIAL, '3'.repeat(40)))
    await refreshing
    assert.equal(h.current.source, CUSTOM)
    assert.equal(h.current.repository.repository, CUSTOM)
    assert.equal(h.current.repository.commit, NEW_SHA)
    assert.equal(h.current.remoteError, '')
    assert.equal(h.current.loadingRemote, false)
  })
}

test('install passes the catalog snapshot repository and commit explicitly', async () => {
  const h = harness(CUSTOM)
  h.state.onList = async repository => catalog(repository, NEW_SHA)
  await h.mount()
  await h.current.install('timer')
  assert.deepEqual(h.state.installs, [['timer', NEW_SHA, CUSTOM]])
})

test('an install callback captured before switching source cannot install from stale cards', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  const staleInstall = h.current.install
  await h.current.changeSource(CUSTOM)
  await staleInstall('timer')
  assert.deepEqual(h.state.installs, [])
  assert.ok(h.state.toasts.some(([message, kind]) => message === 'pluginMarket.operationFailed' && kind === 'error'))
})

test('source validation holds the operation lock against install and another source switch', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  const validation = deferred()
  h.state.onList = async () => validation.promise
  const switching = h.current.changeSource(CUSTOM)
  await h.current.install('timer')
  await assert.rejects(h.current.changeSource('another/source'), /pluginMarket.sourceWait/)
  assert.deepEqual(h.state.installs, [])
  assert.deepEqual(h.state.lists, [OFFICIAL, CUSTOM])
  validation.resolve(catalog(CUSTOM, NEW_SHA))
  await switching
  await h.current.install('timer')
  assert.deepEqual(h.state.installs, [['timer', NEW_SHA, CUSTOM]])
})

test('installation holds the lock against source switches until it settles', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  const installing = deferred()
  h.state.onInstall = async () => installing.promise
  const operation = h.current.install('timer')
  assert.equal(h.current.busyId, 'timer')
  await assert.rejects(h.current.changeSource(CUSTOM), /pluginMarket.sourceWait/)
  assert.deepEqual(h.state.lists, [OFFICIAL])
  assert.equal(h.state.memory.get(KEY), OFFICIAL)
  installing.resolve({ id: 'timer', name: 'Timer' })
  await operation
  assert.equal(h.current.busyId, null)
  await h.current.changeSource(CUSTOM)
  assert.equal(h.current.source, CUSTOM)
})

test('hook unmount unsubscribes mocked Tauri events', async () => {
  const h = harness(OFFICIAL)
  await h.mount()
  assert.deepEqual(h.state.listeners.map(item => item.name), ['plugins-reloaded', 'plugin-enabled-changed'])
  h.unmount()
  assert.ok(h.state.listeners.every(item => item.disposed))
})
