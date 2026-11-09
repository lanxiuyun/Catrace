import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/plugins/loadExternalPlugins.ts', import.meta.url), 'utf8')
const dynamicImport = 'await import(/* @vite-ignore */ blobUrl)'
assert.ok(source.includes(dynamicImport), 'Update the import mock when the loader changes')
const compiled = ts.transpileModule(source.replace(dynamicImport, 'await globalThis.__testImport(blobUrl)'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const plugin = { id: 'test-plugin', name: 'Test', version: '1', enabled: false, hasUi: true, hasSettings: true, events: [] }
const enabled = { ...plugin, enabled: true }

function harness(initial = [plugin]) {
  const state = { plugins: initial, reads: [], imports: 0, scans: 0, created: [], revoked: [], warnings: [], failImport: false, failSource: false, nextList: null }
  const entries = new Map()
  const registry = {
    listExternalNames: () => [...entries.keys()],
    register: handle => entries.set(handle.manifest.name, handle),
    unregister: name => entries.delete(name),
  }
  const api = {
    listExternalPlugins: async () => {
      state.scans++
      return state.nextList ? state.nextList() : state.plugins.map(p => ({ ...p }))
    },
    getPluginUiSource: async id => {
      state.reads.push(`ui:${id}`)
      if (state.failSource) throw new Error('intentional source failure')
      return 'ui'
    },
    getPluginSettingsSource: async id => {
      state.reads.push(`settings:${id}`)
      if (state.failSource) throw new Error('intentional source failure')
      return 'settings'
    },
  }
  const dependencies = {
    vue: { markRaw: value => value },
    '../api/tauri': api,
    '../stores/pluginRegistry': { usePluginRegistry: () => registry },
    './pluginRuntime': { ensurePluginRuntime() {} },
    './pluginApi': { wrapPluginSource: (_id, text) => text },
  }
  const exports = {}
  runInNewContext(compiled, {
    exports,
    require(id) {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`)
      return dependencies[id]
    },
    Blob,
    URL: {
      createObjectURL() {
        const url = `blob:test-${state.created.length + 1}`
        state.created.push(url)
        return url
      },
      revokeObjectURL: url => state.revoked.push(url),
    },
    console: { warn: (...args) => state.warnings.push(args) },
    async __testImport() {
      state.imports++
      if (state.failImport) throw new Error('intentional import failure')
      return { default: { name: 'LegacyVueComponent' } }
    },
  }, { filename: 'loadExternalPlugins.mock.cjs' })
  return { state, entries, load: exports.loadExternalPlugins }
}

function assertNoComponents(entries) {
  assert.equal(entries.get(plugin.id).CardComponent, undefined)
  assert.equal(entries.get(plugin.id).SettingsComponent, undefined)
}

test('disabled install never reads or imports plugin UI/settings', async () => {
  const { state, entries, load } = harness()
  await load()
  assert.deepEqual(state.reads, [])
  assert.equal(state.imports, 0)
  assert.equal(entries.get(plugin.id).enabled, false)
  assertNoComponents(entries)
})

test('explicit enable imports both legacy Vue modules', async () => {
  const { state, entries, load } = harness()
  await load()
  state.plugins = [enabled]
  await load()
  assert.deepEqual(state.reads, ['ui:test-plugin', 'settings:test-plugin'])
  assert.equal(state.imports, 2)
  assert.ok(entries.get(plugin.id).CardComponent)
  assert.ok(entries.get(plugin.id).SettingsComponent)
})

test('unchanged fingerprint skips imports but force refresh rebuilds', async () => {
  const { state, load } = harness([enabled])
  await load()
  await load()
  assert.equal(state.imports, 2)
  await load({ force: true })
  assert.equal(state.imports, 4)
  assert.equal(state.revoked.length, 2)
})

test('disable removes components and revokes both Blob URLs', async () => {
  const { state, entries, load } = harness([enabled])
  await load()
  state.plugins = [plugin]
  await load()
  assertNoComponents(entries)
  assert.equal(state.imports, 2)
  assert.deepEqual(state.revoked, state.created)
})

test('uninstall and invalid plugin entries unregister and revoke blobs', async () => {
  for (const next of [[], [{ ...enabled, error: 'invalid manifest' }]]) {
    const { state, entries, load } = harness([enabled])
    await load()
    state.plugins = next
    await load()
    assert.equal(entries.size, 0)
    assert.deepEqual(state.revoked, state.created)
  }
})

test('failed imports release both old and newly failed module blobs', async () => {
  const { state, entries, load } = harness([enabled])
  await load()
  state.failImport = true
  await load({ force: true })
  assertNoComponents(entries)
  assert.equal(state.created.length, 4)
  assert.equal(state.revoked.length, 4)
  assert.deepEqual(new Set(state.revoked), new Set(state.created))
})

test('source failures release the previous module blobs', async () => {
  const { state, entries, load } = harness([enabled])
  await load()
  state.failSource = true
  await load({ force: true })
  assertNoComponents(entries)
  assert.deepEqual(state.revoked, state.created)
})

test('concurrent persisted changes queue a fresh scan for all callers', async () => {
  for (const force of [false, true]) {
    const { state, entries, load } = harness()
    let release
    state.nextList = () => new Promise(resolve => { release = resolve })
    const first = load()
    state.plugins = [enabled]
    const second = load({ force })
    state.nextList = null
    release([plugin])
    await Promise.all([first, second])
    assert.equal(state.scans, 2)
    assert.equal(entries.get(plugin.id).enabled, true)
    assert.ok(entries.get(plugin.id).SettingsComponent)
  }
})

test('force requested during an unchanged scan is not swallowed', async () => {
  const { state, load } = harness([enabled])
  await load()
  let release
  state.nextList = () => new Promise(resolve => { release = resolve })
  const first = load()
  const second = load({ force: true })
  state.nextList = null
  release([enabled])
  await Promise.all([first, second])
  assert.equal(state.scans, 3)
  assert.equal(state.imports, 4)
  assert.equal(state.revoked.length, 2)
})
