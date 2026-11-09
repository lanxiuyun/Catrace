import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Execute the real TSX and shared validator. Only host I/O, hook scheduling and time
// are controlled: no browser, network, AppData, dev server or extra dependencies.
const sources = new Map()
function compiled(relative) {
  if (sources.has(relative)) return sources.get(relative)
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
  const result = ts.transpileModule(source.replaceAll('import.meta.env.DEV', 'false'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    transformers: { before: [context => {
      const visit = node => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'), '__testImport'), undefined, node.arguments)
        : ts.visitEachChild(node, visit, context)
      return node => ts.visitNode(node, visit)
    }] },
  }).outputText
  sources.set(relative, result)
  return result
}

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function clock() {
  const timers = new Map()
  let now = 0, nextId = 0
  return {
    Date: class extends Date { static now() { return now } },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id },
    clearTimeout(id) { timers.delete(id) },
    advance(ms) {
      const target = now + ms
      while (true) {
        const next = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at
        timers.delete(next[0])
        next[1].fn()
      }
      now = target
    },
    get pending() { return timers.size },
  }
}
function hooks() {
  const slots = []
  let cursor = 0, effects = []
  const changed = (old, next) => !old || !next || old.length !== next.length || next.some((value, i) => !Object.is(value, old[i]))
  const useEffect = (effect, deps) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || changed(previous.deps, deps)) {
      slots[index] = { deps }
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect() })
    }
  }
  return {
    begin() { cursor = 0 },
    flushEffects() { const pending = effects; effects = []; for (const run of pending) run() },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
    api: {
      useState(initial) {
        const index = cursor++
        if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
        return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
      },
      useRef(initial) {
        const index = cursor++
        if (!slots[index]) slots[index] = { current: initial }
        return slots[index]
      },
      useEffect, useLayoutEffect: useEffect,
      useSyncExternalStore(subscribe, snapshot) {
        const index = cursor++
        if (!slots[index]) slots[index] = { cleanup: subscribe(() => {}) }
        return snapshot()
      },
    },
  }
}

function harness() {
  const time = clock()
  const modules = new Map(), instances = new Map(), listeners = new Map()
  let active, nextId = 0
  const state = {
    registry: new Map(), reads: [], imports: [], created: [], revoked: [], warnings: [],
    source: async () => 'export default function Card() {}',
    module: { default: () => React.createElement('div', null, 'Imported React card') },
    importer: null,
    updateSource: 'auto', savedSources: [], opened: [], failSaveSource: false,
  }
  const registry = { getPlugin: id => state.registry.get(id) }
  const usePluginRegistry = select => select(registry)
  usePluginRegistry.getState = () => registry
  const react = {
    ...React,
    useId: () => `test-${++nextId}`,
    ...Object.fromEntries(['useState', 'useRef', 'useEffect', 'useLayoutEffect', 'useSyncExternalStore'].map(name => [name, (...args) => active.api[name](...args)])),
  }
  const dependencies = {
    react, 'react/jsx-runtime': jsxRuntime,
    '../app/i18n': { useT: () => key => key === 'common.close' ? 'Close' : key },
    '../stores/pluginRegistry': { usePluginRegistry },
    '../api/tauri': {
      getPluginUiSource: async id => { state.reads.push(id); return state.source(id) },
      getUpdateSource: async () => state.updateSource,
      setUpdateSource: async source => {
        if (state.failSaveSource) throw new Error('intentional source save failure')
        state.savedSources.push(source)
      },
    },
    '@tauri-apps/plugin-opener': { openUrl: async url => { state.opened.push(url) } },
    '../plugins/pluginRuntime': { ensurePluginRuntime() {} },
    '../plugins/pluginApi': { wrapPluginSource: (_id, source) => source },
  }
  function evaluate(relative) {
    if (modules.has(relative)) return modules.get(relative)
    const exports = {}
    runInNewContext(compiled(relative), {
      exports,
      require(id) {
        if (id.endsWith('.css')) return {}
        if (Object.hasOwn(dependencies, id)) return dependencies[id]
        if (id === '../plugins/pluginComponent') return evaluate('../src/plugins/pluginComponent.ts')
        if (id.startsWith('./')) {
          const name = id.slice(2)
          return evaluate(`../src/components/${name}.${name === 'pluginHostCardCache' ? 'ts' : 'tsx'}`)
        }
        throw new Error(`Unexpected dependency ${id} in ${relative}`)
      },
      console: { warn: (...args) => state.warnings.push(args), error: (...args) => state.warnings.push(args) },
      Blob, Date: time.Date, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
      URL: {
        createObjectURL() { const url = `blob:card-${state.created.length + 1}`; state.created.push(url); return url },
        revokeObjectURL(url) { state.revoked.push(url) },
      },
      window: {
        addEventListener(name, callback) { listeners.set(name, callback) },
        removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name) },
      },
      async __testImport(url) { state.imports.push(url); return state.importer ? state.importer(url) : state.module },
    }, { filename: relative })
    modules.set(relative, exports)
    return exports
  }
  const component = name => evaluate(`../src/components/${name}.tsx`).default
  return {
    state, time, listeners, component,
    cache: () => evaluate('../src/components/pluginHostCardCache.ts'),
    validator: () => evaluate('../src/plugins/pluginComponent.ts'),
    render(name, props, key = name, runEffects = true) {
      if (!instances.has(key)) instances.set(key, hooks())
      active = instances.get(key)
      active.begin()
      const element = component(name)(props)
      if (runEffects) active.flushEffects()
      return element
    },
    unmount(key) { instances.get(key)?.unmount() },
  }
}

function descendants(node) {
  if (!React.isValidElement(node)) return []
  return [node, ...React.Children.toArray(node.props.children).flatMap(descendants)]
}
const buttons = node => descendants(node).filter(item => item.type === 'button')
const byClass = (node, name) => descendants(node).find(item => item.props.className?.split(' ').includes(name))
const pluginEvent = {
  id: 'event-1', kind: 'test', event_type: 'test.tick', source: { type: 'plugin', name: 'test' },
  title: 'Plugin', body: '', level: 'info', sticky: false, actions: [{ id: 'ack', label: 'Done' }],
}
const owner = (extra = {}) => ({ manifest: { name: 'test', events: ['test'], version: '1' }, external: true, enabled: true, ...extra })

test('rest card preserves close, snooze, skip and hover-paused progress', () => {
  const h = harness(), calls = []
  const tree = h.render('RestToastCard', { title: 'Rest', body: 'Break', isHovered: true, onClose: () => calls.push('close'), onSnooze: minutes => calls.push(minutes), onSkip: () => calls.push('skip') })
  buttons(tree).forEach(button => button.props.onClick())
  assert.deepEqual(calls, ['close', 5, 10, 'skip'])
  assert.match(renderToStaticMarkup(tree), /progress-bar paused/)
  const resumed = h.render('RestToastCard', { title: 'Rest', body: 'Break', isHovered: false })
  assert.equal(byClass(resumed, 'progress-bar').props.className, 'progress-bar')
})

test('SDK card preserves sticky mode, bounded progress and action IDs', () => {
  const h = harness(), actions = [{ id: 'first', label: 'First' }, { id: 'last', label: 'Last' }]
  let action
  const tree = h.render('SdkToastCard', { title: 'SDK', body: 'Body', sticky: true, progress: { current: 25, total: 10 }, actions, onAction: id => { action = id } })
  buttons(tree).at(-1).props.onClick()
  assert.equal(action, 'last')
  const html = renderToStaticMarkup(tree)
  assert.match(html, /width:100%/)
  assert.doesNotMatch(html, /class="progress-bar/)
  assert.equal(buttons(tree).at(-1).props.className, 'btn btn-primary')
})

test('notification card keeps body activation separate from close and full action payloads', () => {
  const h = harness(), actions = [{ id: 'reply', label: 'Reply', payload: { target: 'source' } }]
  let activated = 0, closed = 0, stopped = 0, received
  const tree = h.render('NotificationToastCard', { title: 'Title', body: 'Title', appName: 'Messenger', bodyAction: true, isHovered: true, actions, onActivate: () => activated++, onClose: () => closed++, onAction: action => { received = action } })
  const event = { stopPropagation() { stopped++ } }
  tree.props.onClick()
  buttons(tree)[0].props.onClick(event)
  buttons(tree)[1].props.onClick(event)
  assert.equal(activated, 1)
  assert.equal(closed, 1)
  assert.equal(stopped, 2)
  assert.equal(received, actions[0])
  assert.doesNotMatch(renderToStaticMarkup(tree), /notif-body/)
  assert.match(renderToStaticMarkup(tree), /progress-bar paused/)
})

test('rest timer clamps progress and each SVG uses unique definitions; special day retains the flag', () => {
  const h = harness()
  const complete = renderToStaticMarkup(h.render('RestTimerBall', { restStreak: 5, breakMinutes: 5 }, 'ball-a'))
  const empty = renderToStaticMarkup(h.render('RestTimerBall', { restStreak: 0, breakMinutes: 0 }, 'ball-b'))
  assert.match(complete, /rest-timer--complete/)
  assert.match(complete, /stroke-dashoffset="0"/)
  assert.doesNotMatch(empty, /rest-timer--complete/)
  assert.notEqual(complete.match(/id="(rest-progress-gradient-[^"]+)"/)[1], empty.match(/id="(rest-progress-gradient-[^"]+)"/)[1])
  const special = h.render('SpecialDayToastCard', { title: 'Day', body: 'Text', tag: 'Tag', icon: 'CN', category: 'history' })
  assert.match(renderToStaticMarkup(special), /class="cn-flag"/)
  let closed = 0
  const timer = h.render('RestTimerToastCard', { title: 'Timer', body: 'Resting', restStreak: 1, breakMinutes: 5, onClose: () => closed++ })
  buttons(timer)[0].props.onClick()
  assert.equal(closed, 1)
})

test('update card preserves source persistence, install, details, resize and busy state', async () => {
  const h = harness()
  h.state.updateSource = 'github'
  let installed, sourceChanged, toggled = 0, resized = 0
  const props = { version: '1.2.3', onInstall: source => { installed = source }, onSourceChange: source => { sourceChanged = source }, onToggleDetails: () => toggled++, onResize: () => resized++ }
  h.render('UpdateToastCard', props)
  await flush()
  let tree = h.render('UpdateToastCard', props)
  assert.equal(descendants(tree).find(item => item.type === 'select').props.value, 'github')
  buttons(tree).at(-1).props.onClick()
  buttons(tree).at(-2).props.onClick()
  assert.equal(installed, 'github')
  assert.equal(toggled, 1)
  assert.equal(resized, 1)
  descendants(tree).find(item => item.type === 'select').props.onChange({ currentTarget: { value: 'ghfast' } })
  await flush()
  assert.deepEqual(h.state.savedSources, ['ghfast'])
  assert.equal(sourceChanged, 'ghfast')
  tree = h.render('UpdateToastCard', { ...props, updateInstalling: true, downloadProgress: 42 })
  assert.doesNotMatch(renderToStaticMarkup(tree), /class="close-btn"/)
  assert.match(renderToStaticMarkup(tree), /42%/)
  assert.equal(buttons(tree).at(-1).props.disabled, true)
  h.unmount('UpdateToastCard')
  assert.equal(h.listeners.size, 0)
})

test('update notes load on request and its timeout, fallback and browser link remain usable', async () => {
  const h = harness(), props = { showUpdateBody: true, updateBody: 'Fallback notes' }
  let tree = h.render('UpdateToastCard', props)
  assert.equal(descendants(tree).some(item => item.type === 'iframe'), false)
  byClass(tree, 'notes-link').props.onClick()
  tree = h.render('UpdateToastCard', props)
  const frame = descendants(tree).find(item => item.type === 'iframe')
  assert.equal(frame.props.sandbox, 'allow-same-origin allow-scripts')
  assert.equal(h.time.pending, 1)
  frame.props.onLoad()
  assert.equal(h.time.pending, 0)
  buttons(tree).find(item => item.props.children === '浏览器打开 ↗').props.onClick()
  await flush()
  assert.deepEqual(h.state.opened, ['https://lanxiuyun.github.io/Catrace/latest/'])
  // A subsequent explicit request which never loads must expose retry and fallback text.
  frame.props.onError()
  tree = h.render('UpdateToastCard', props)
  byClass(tree, 'notes-link').props.onClick()
  h.time.advance(8000)
  tree = h.render('UpdateToastCard', props)
  assert.match(renderToStaticMarkup(tree), /Fallback notes/)
  assert.equal(descendants(tree).some(item => item.type === 'iframe'), false)
  h.unmount('UpdateToastCard')
  assert.equal(h.time.pending, 0)
})

for (const [kind, make] of [
  ['function', () => props => React.createElement('span', null, `${props.event.title}:function`)],
  ['memo', () => React.memo(props => React.createElement('span', null, `${props.event.title}:memo`))],
  ['forwardRef', () => React.forwardRef((props, ref) => React.createElement('span', { ref }, `${props.event.title}:forwardRef`))],
]) {
  test(`plugin host renders an enabled React ${kind} from the registry and forwards card callbacks`, () => {
    const h = harness(), Card = make(), calls = []
    h.state.registry.set('test', owner({ CardComponent: Card }))
    const tree = h.render('PluginHostCard', { event: pluginEvent, remainingMs: 2000, totalMs: 8000, onClose: () => calls.push('close'), onAction: (id, payload) => calls.push([id, payload]) })
    assert.match(renderToStaticMarkup(tree), new RegExp(`Plugin:${kind}`))
    assert.equal(tree.props.card, Card)
    assert.equal(tree.props.cardProps.remainingMs, 2000)
    tree.props.cardProps.onClose()
    tree.props.cardProps.onAction('reply', { text: 'yes' })
    assert.deepEqual(calls, ['close', ['reply', { text: 'yes' }]])
    assert.equal(h.state.reads.length, 0)
    assert.equal(h.state.imports.length, 0)
  })

  test(`plugin host dynamically loads a React ${kind}, caches it and revokes its Blob URL`, async () => {
    const h = harness(), Card = make()
    h.state.registry.set('test', owner())
    h.state.module = { Card }
    h.render('PluginHostCard', { event: pluginEvent })
    await flush()
    const tree = h.render('PluginHostCard', { event: { ...pluginEvent, id: 'event-2' } })
    assert.match(renderToStaticMarkup(tree), new RegExp(`Plugin:${kind}`))
    assert.equal(h.state.reads.length, 1)
    assert.equal(h.state.imports.length, 1)
    assert.equal(h.cache().getPluginHostCardCache().get('test'), Card)
    assert.deepEqual(h.state.revoked, h.state.created)
    assert.equal(h.time.pending, 0)
  })
}

test('disabled and uninstalled plugins never render cached modules or start source reads', () => {
  const h = harness()
  let executions = 0
  const Card = () => { executions++; return React.createElement('span', null, 'Active') }
  h.state.registry.set('test', owner({ CardComponent: Card }))
  renderToStaticMarkup(h.render('PluginHostCard', { event: pluginEvent }))
  assert.equal(executions, 1)
  for (const next of [owner({ enabled: false, CardComponent: Card }), undefined]) {
    if (next) h.state.registry.set('test', next)
    else h.state.registry.delete('test')
    const tree = h.render('PluginHostCard', { event: pluginEvent })
    assert.equal(tree.type, h.component('SdkToastCard'))
    renderToStaticMarkup(tree)
    assert.equal(executions, 1)
    assert.equal(h.cache().getPluginHostCardCache().has('test'), false)
    assert.equal(h.state.reads.length, 0)
    assert.equal(h.state.imports.length, 0)
  }
})

for (const stage of ['source', 'import']) {
  for (const revoke of ['disable', 'uninstall', 'generation']) {
    test(`pending plugin ${stage} cannot repopulate the cache after ${revoke}`, async () => {
      const h = harness(), pending = deferred()
      h.state.registry.set('test', owner())
      if (stage === 'source') h.state.source = () => pending.promise
      else h.state.importer = () => pending.promise
      h.render('PluginHostCard', { event: pluginEvent })
      await flush()
      if (revoke === 'disable') h.state.registry.set('test', owner({ enabled: false }))
      if (revoke === 'uninstall') h.state.registry.delete('test')
      if (revoke === 'generation') h.cache().clearPluginHostCardCache()
      pending.resolve(stage === 'source' ? 'module source' : h.state.module)
      await flush()
      assert.equal(h.cache().getPluginHostCardCache().size, 0)
      assert.equal(h.state.imports.length, stage === 'source' ? 0 : 1)
      assert.deepEqual(h.state.revoked, h.state.created)
      assert.equal(h.time.pending, 0)
    })
  }

  test(`plugin ${stage} timeout renders SDK error and late completion cannot cache a component`, async () => {
    const h = harness(), pending = deferred()
    h.state.registry.set('test', owner())
    if (stage === 'source') h.state.source = () => pending.promise
    else h.state.importer = () => pending.promise
    h.render('PluginHostCard', { event: pluginEvent })
    await flush()
    h.time.advance(10_000)
    await flush()
    const tree = h.render('PluginHostCard', { event: pluginEvent })
    assert.equal(tree.type, h.component('SdkToastCard'))
    assert.equal(tree.props.level, 'error')
    assert.match(tree.props.body, /Failed to load/)
    pending.resolve(stage === 'source' ? 'module source' : h.state.module)
    await flush()
    assert.equal(h.cache().getPluginHostCardCache().size, 0)
    assert.equal(h.state.imports.length, stage === 'source' ? 0 : 1)
    assert.deepEqual(h.state.revoked, h.state.created)
    assert.equal(h.time.pending, 0)
  })
}

test('Vue options-object exports fail to SDK fallback and never enter the React cache', async () => {
  const h = harness()
  h.state.registry.set('test', owner())
  h.state.module = { default: { setup() {}, render() {} } }
  h.render('PluginHostCard', { event: pluginEvent })
  await flush()
  const tree = h.render('PluginHostCard', { event: pluginEvent })
  assert.equal(tree.type, h.component('SdkToastCard'))
  assert.equal(tree.props.level, 'error')
  assert.equal(h.cache().getPluginHostCardCache().size, 0)
  assert.deepEqual(h.state.revoked, h.state.created)
  assert.equal(h.validator().isPluginComponent(h.state.module.default), false)
})

test('cache generation notifies subscribers and causes mounted host keys to change', () => {
  const h = harness(), Card = () => React.createElement('span', null, 'Card')
  h.state.registry.set('test', owner({ CardComponent: Card }))
  const first = h.render('PluginHostCard', { event: pluginEvent })
  const cache = h.cache(), before = cache.getPluginHostCardCacheGeneration()
  let notifications = 0
  const unsubscribe = cache.subscribePluginHostCardCache(() => notifications++)
  cache.clearPluginHostCardCache()
  assert.equal(cache.getPluginHostCardCache().size, 0)
  assert.equal(cache.getPluginHostCardCacheGeneration(), before + 1)
  assert.equal(notifications, 1)
  const second = h.render('PluginHostCard', { event: pluginEvent })
  assert.notEqual(first.key, second.key)
  unsubscribe()
  cache.clearPluginHostCardCache()
  assert.equal(notifications, 1)
})
