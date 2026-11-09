/**
 * React plugin contract regression tests. No browser, Tauri, network or AppData.
 *
 * Host-only / CI: node --test scripts/test-react-plugin-packages.mjs
 * Package scan (PowerShell):
 *   $env:CATRACE_PLUGIN_SOURCE = 'C:\work_sapce\catrace-plugin'
 *   node --test scripts/test-react-plugin-packages.mjs
 * Direct invocation also accepts --plugin-source=<absolute-directory>.
 *
 * Components use the real React / Radix namespaces and react-dom/server. SSR does
 * not execute effects: this validates initial render and callback wiring, not
 * browser layout, post-mount polling, dialogs, iframe navigation or full workflows.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import * as React from 'react'
import * as RadixThemes from '@radix-ui/themes'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED_IDS = [
  'agent-notify', 'bt-music', 'dota2-typewriter', 'dsh-chat', 'github-notify',
  'heatmap', 'linuxdo-notify', 'napcat-qq', 'notify-demo', 'pastedrop',
  'pywechat-reply', 'sidecar-echo', 'smsforwarder-notify', 'timer', 'wecom-todo',
].sort()
const sourceFlag = process.argv.find((arg) => arg.startsWith('--plugin-source='))
const sourceIndex = process.argv.indexOf('--plugin-source')
const sourceInput = sourceFlag?.slice('--plugin-source='.length)
  || (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : '')
  || process.env.CATRACE_PLUGIN_SOURCE
const SOURCE = sourceInput ? resolve(sourceInput) : null
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '')

/** Run real host TS modules with only their I/O imports replaced. */
function hostModule(path, dependencies = {}) {
  const filename = join(ROOT, path)
  const compiled = ts.transpileModule(read(filename), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const exports = {}
  runInNewContext(compiled, {
    exports,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id} in ${path}`)
      return dependencies[id]
    },
    console,
    globalThis,
  }, { filename })
  return exports
}
const theme = hostModule('src/theme/rewriteThemeColors.ts')
const noTauri = () => { throw new Error('Tauri I/O is forbidden in React package contract tests') }
const apiModule = hostModule('src/plugins/pluginApi.ts', {
  '@tauri-apps/api/core': { invoke: noTauri },
  '@tauri-apps/api/event': { listen: noTauri },
  '../theme/rewriteThemeColors': theme,
})
const { wrapPluginSource } = apiModule
const { isPluginComponent } = hostModule('src/plugins/pluginComponent.ts')
const runtime = hostModule('src/plugins/pluginRuntime.ts', {
  react: React,
  '@radix-ui/themes': RadixThemes,
  './pluginApi': apiModule,
})

function memoryFacade(id) {
  const state = { id, config: {}, storage: new Map(), calls: [] }
  const record = (name, result) => async (...args) => {
    state.calls.push([name, ...args])
    return typeof result === 'function' ? result(...args) : result
  }
  return { state, facade: {
    config: { get: record('config.get', () => state.config), set: record('config.set', (next) => { state.config = { ...state.config, ...next } }) },
    storage: { get: record('storage.get', (key) => state.storage.get(key) ?? null), set: record('storage.set', (key, value) => state.storage.set(key, value)), remove: record('storage.remove', (key) => state.storage.delete(key)) },
    events: { publish: record('events.publish', { eventId: 'test-event' }), close: record('events.close') },
    activity: { get: record('activity.get', { active: true, count: 1 }), getRecords: record('activity.getRecords', []), getLastRealRest: record('activity.getLastRealRest', null) },
    audio: { play: record('audio.play', 'test-playback'), stop: record('audio.stop'), pause: record('audio.pause'), resume: record('audio.resume'), setVolume: record('audio.setVolume'), isPlaying: record('audio.isPlaying', false) },
    path: { get: record('path.get', '/memory/test'), getPluginDir: record('path.getPluginDir', `/memory/plugins/${id}`) },
    dialog: { showOpenDialog: record('dialog.showOpenDialog', null), showSaveDialog: record('dialog.showSaveDialog', null), pickFile: record('dialog.pickFile', null), pickFolder: record('dialog.pickFolder', null) },
    clipboard: { writeText: record('clipboard.writeText'), readText: record('clipboard.readText', '') },
    sidecar: { request: record('sidecar.request', {}) },
    i18n: { getLocale: record('i18n.getLocale', 'zh-CN') },
    theme: { isDark: record('theme.isDark', false), css: theme.rewriteThemeColors },
    platform: { getInfo: record('platform.getInfo', { os: 'windows', arch: 'x86_64', family: 'windows' }) },
    log: { info: record('log.info'), warn: record('log.warn'), error: record('log.error') },
    setEnabled: record('setEnabled'),
    notification: { show: record('notification.show') },
    shell: { openExternal: record('shell.openExternal'), openPath: record('shell.openPath'), showItemInFolder: record('shell.showItemInFolder'), beep: record('shell.beep') },
    env: { getAll: record('env.getAll', {}) },
    window: { hideMain: record('window.hideMain'), showMain: record('window.showMain') },
    screen: { getAllDisplays: record('screen.getAllDisplays', []), getCursorPoint: record('screen.getCursorPoint', { x: 0, y: 0 }), getDisplayNearestPoint: record('screen.getDisplayNearestPoint', null) },
    process: { spawn: record('process.spawn', { pid: 1 }) },
    http: { get: record('http.get', { status: 200, body: '{}', url: 'https://example.invalid' }) },
  } }
}

async function withRuntime(run) {
  const keys = ['__CATRACE_REACT__', '__CATRACE_RADIX__', '__CATRACE_CREATE_PLUGIN_API__', 'fetch']
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const memory = new Map()
  const get = (id) => {
    if (!memory.has(id)) memory.set(id, memoryFacade(id))
    return memory.get(id)
  }
  Object.defineProperties(globalThis, {
    __CATRACE_REACT__: { configurable: true, writable: true, value: React },
    __CATRACE_RADIX__: { configurable: true, writable: true, value: RadixThemes },
    __CATRACE_CREATE_PLUGIN_API__: { configurable: true, writable: true, value: (id) => get(id).facade },
    fetch: { configurable: true, writable: true, value: () => { throw new Error('Network is forbidden in React package contract tests') } },
  })
  try { return await run(get) }
  finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

let moduleSequence = 0
async function importPlugin(id, source, helperNames = []) {
  // A data URL has the same self-contained ESM constraints as the host Blob URL.
  const wrapped = wrapPluginSource(id, source)
    + (helperNames.length ? `\nexport { ${helperNames.join(', ')} };` : '')
    + `\n//# sourceURL=catrace-plugin-contract-${id}-${++moduleSequence}.mjs\n`
  return import(`data:text/javascript;base64,${Buffer.from(wrapped).toString('base64')}`)
}

/** Capture real React element objects while React SSR owns the hook dispatcher. */
function renderCaptured(Component, props = {}) {
  const nodes = []
  const wrappers = new WeakMap()
  function capture(node) {
    if (Array.isArray(node)) return node.map(capture)
    if (!React.isValidElement(node)) return node
    nodes.push(node)
    if (typeof node.type === 'function' && !node.type.prototype?.isReactComponent) {
      let Wrapper = wrappers.get(node.type)
      if (!Wrapper) {
        const Original = node.type
        Wrapper = function ContractCapturedComponent(nextProps) { return capture(Original(nextProps)) }
        Wrapper.displayName = `ContractCaptured(${Original.displayName || Original.name || 'Component'})`
        wrappers.set(Original, Wrapper)
      }
      return React.createElement(Wrapper, { ...node.props, key: node.key })
    }
    if (Object.hasOwn(node.props, 'children')) {
      const children = node.props.children
      return Array.isArray(children)
        ? React.cloneElement(node, {}, ...children.map(capture))
        : React.cloneElement(node, {}, capture(children))
    }
    return node
  }
  function Root() { return capture(React.createElement(Component, props)) }
  const warnings = []
  const originalError = console.error
  console.error = (...args) => {
    if (String(args[0]).includes('Each child in a list')) warnings.push(args)
    else originalError(...args)
  }
  let html
  try { html = renderToStaticMarkup(React.createElement(RadixThemes.Theme, null, React.createElement(Root))) }
  finally { console.error = originalError }
  assert.equal(warnings.length, 0, `${Component.name}: dynamic React children require stable keys`)
  return { html, nodes }
}
function textOf(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return React.isValidElement(node) ? textOf(node.props.children) : ''
}
const clickEvent = () => ({ preventDefault() {}, stopPropagation() {}, nativeEvent: {}, currentTarget: {}, target: {} })
const closeNode = (nodes) => nodes.find((node) => typeof node.props.onClick === 'function'
  && /close|关闭/i.test(String(node.props['aria-label'] || node.props.title || '')))
const actionNode = (nodes, label) => nodes.find((node) => typeof node.props.onClick === 'function' && !node.props.disabled && textOf(node) === label)

function assertSelfContained(source, label) {
  const tree = ts.createSourceFile(label, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
  assert.equal(tree.parseDiagnostics.length, 0, `${label}: JavaScript parse error`)
  function visit(node) {
    assert.ok(!ts.isImportDeclaration(node) && !ts.isImportEqualsDeclaration(node), `${label}: Blob UI modules cannot use imports`)
    assert.ok(!(ts.isExportDeclaration(node) && node.moduleSpecifier), `${label}: re-export imports are not self-contained`)
    assert.ok(!(ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword), `${label}: dynamic imports are not self-contained`)
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) assert.ok(!['__CATRACE_VUE__', '__CATRACE_NAIVE__'].includes(node.text), `${label}: Vue/naive runtime reference`)
    ts.forEachChild(node, visit)
  }
  visit(tree)
}

function packagePath(id, entry) {
  assert.equal(typeof entry, 'string')
  assert.ok(entry && !isAbsolute(entry) && !entry.split(/[\\/]/).includes('..'), `${id}: unsafe manifest entry ${entry}`)
  const base = join(SOURCE, id)
  const path = resolve(base, entry)
  assert.ok(relative(base, path) && !relative(base, path).startsWith(`..${sep}`), `${id}: entry escapes package`)
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), `${id}: entry must be a regular file`)
  return path
}
function packages() {
  return readdirSync(SOURCE, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(SOURCE, entry.name, 'manifest.json')))
    .map((entry) => ({ id: entry.name, manifest: JSON.parse(read(join(SOURCE, entry.name, 'manifest.json'))) }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
function eventFor(id) {
  return {
    id: `contract-${id}`, event_type: `${id}.contract`, kind: id,
    title: 'Contract title', body: 'Contract body 123456', created_at: Date.now(), sticky: false,
    actions: [{ id: 'contract-action', label: 'Contract action' }],
    payload: { title: 'Contract title', appName: 'Contract app', deviceName: 'Contract device', count: 3,
      entry: { event: 'Stop', state: 'attention', sessionId: 'contract-session', sessionTitle: 'Contract title', projectName: 'Contract project', agentId: 'claude' } },
  }
}

// These tests always run, including CI installations with no sibling plugin repository.
test('host accepts real React exports, rejects Vue options and renders without a compatibility shim', async () => {
  assert.equal(isPluginComponent(() => null), true)
  assert.equal(isPluginComponent(React.memo(() => null)), true)
  assert.equal(isPluginComponent(React.forwardRef(() => null)), true)
  for (const value of [null, {}, { setup() {} }, { render() {} }]) assert.equal(isPluginComponent(value), false)
  await withRuntime(async () => {
    const { default: Card } = await importPlugin('contract-probe', `
      const { createElement: h, useState } = globalThis.__CATRACE_REACT__;
      export default function Card({event,onClose,onAction}) {
        const [title] = useState(event.title);
        return h('section',null,h('strong',null,title),
          h('button',{'aria-label':'Close',onClick:()=>onClose()},'×'),
          h('button',{onClick:()=>onAction('ack')},'Acknowledge'));
      }`)
    assert.equal(isPluginComponent(Card), true)
    const calls = []
    const captured = renderCaptured(Card, { event: { title: 'Real hooks' }, onClose: () => calls.push('close'), onAction: (id) => calls.push(id) })
    assert.match(captured.html, /Real hooks/)
    closeNode(captured.nodes).props.onClick(clickEvent())
    actionNode(captured.nodes, 'Acknowledge').props.onClick(clickEvent())
    assert.deepEqual(calls, ['close', 'ack'])
  })
})

test('real host runtime installs React and Radix namespaces without invoking Tauri', async () => {
  await withRuntime(async () => {
    globalThis.__CATRACE_REACT__ = undefined
    globalThis.__CATRACE_RADIX__ = undefined
    globalThis.__CATRACE_CREATE_PLUGIN_API__ = undefined
    runtime.ensurePluginRuntime()
    assert.equal(globalThis.__CATRACE_REACT__, React)
    assert.equal(globalThis.__CATRACE_RADIX__, RadixThemes)
    assert.equal(globalThis.__CATRACE_CREATE_PLUGIN_API__, apiModule.createPluginApi)
    assert.equal(typeof apiModule.createPluginApi('memory-only').config.get, 'function')
  })
})

test('real source wrapper binds identity but leaves JavaScript config and color data intact', async () => {
  await withRuntime(async (get) => {
    const id = 'quoted-plugin-"-identity'
    const mod = await importPlugin(id, `
      export const identity = plugin;
      export const config = { accent: '#7c3aed', title: '#ffffff', colors: ['#8b5cf6', '#fff'] };
      const {createElement:h}=globalThis.__CATRACE_REACT__;
      export default function Settings(){return h('div',null,'wrapped')}
    `)
    assert.equal(mod.identity, get(id).facade)
    assert.deepEqual(mod.config, { accent: '#7c3aed', title: '#ffffff', colors: ['#8b5cf6', '#fff'] })
    assert.match(renderCaptured(mod.default).html, /wrapped/)
    const realApi = apiModule.createPluginApi('theme-contract')
    assert.equal(realApi.theme.css, theme.rewriteThemeColors)
    assert.equal(realApi.theme.css('.card { color: #7c3aed; background: #fff }'), theme.rewriteThemeColors('.card { color: #7c3aed; background: #fff }'))
    assert.match(realApi.theme.css('.card { color: #7c3aed; }'), /var\(--ct-accent\)/)
  })
})

test('all external plugin packages use the React contract', { skip: SOURCE ? false : 'Set CATRACE_PLUGIN_SOURCE to scan the external plugin repository', concurrency: false }, async (t) => {
  assert.ok(lstatSync(SOURCE).isDirectory(), 'CATRACE_PLUGIN_SOURCE must be an existing directory')
  const list = packages()
  assert.deepEqual(list.map((entry) => entry.id).sort(), EXPECTED_IDS, 'The complete fifteen-package inventory must be covered')
  for (const { id, manifest } of list) await t.test(id, async () => {
    assert.equal(manifest.id, id)
    assert.equal(manifest.uiFramework, 'react')
    assert.equal(manifest.version, '2026.11.09')
    await withRuntime(async (get) => {
      for (const field of ['main', 'settings', 'background']) {
        if (!manifest[field]) continue
        const path = packagePath(id, manifest[field])
        const source = read(path)
        assertSelfContained(source, `${id}/${manifest[field]}`)
        if (field === 'background') continue // Never execute schedulers or their timers.
        const mod = await importPlugin(id, source)
        const Component = mod.default || mod[field === 'main' ? 'Card' : 'Settings']
        assert.equal(isPluginComponent(Component), true, `${id}/${manifest[field]} must export a React component`)
        assert.equal(typeof Component, 'function', `${id}: package exports must be genuine function components`)
        const callbacks = []
        const props = field === 'main' ? { event: eventFor(id), isHovered: false, totalMs: 8000,
          onClose: () => callbacks.push(['close']), onAction: (...args) => callbacks.push(['action', ...args]) } : {}
        const captured = renderCaptured(Component, props)
        assert.ok(captured.html.length > 100, `${id}/${field} should SSR a visible initial surface`)
        assert.ok(captured.nodes.some((node) => typeof node.type === 'string' && node.props.children != null), `${id}/${field}: a null export must not pass just because the Radix Theme wrapper renders`)
        if (field === 'settings') {
          assert.equal(get(id).state.calls.length, 0, `${id}: settings initial SSR must not run effects or I/O`)
          continue
        }
        // These compact conversation/demo cards close through their action buttons
        // or host-managed lifetime, rather than an internal close affordance.
        const actionOrTimeoutClose = ['sidecar-echo', 'napcat-qq', 'pywechat-reply'].includes(id)
        if (!actionOrTimeoutClose) {
          const close = closeNode(captured.nodes)
          assert.ok(close, `${id}: close callback must be wired to a rendered control`)
          await close.props.onClick(clickEvent())
          assert.ok(callbacks.some(([kind]) => kind === 'close'), `${id}: rendered close control did not call onClose`)
        }
        const genericActions = ['timer', 'github-notify', 'linuxdo-notify', 'wecom-todo', 'sidecar-echo']
        if (genericActions.includes(id)) {
          const action = actionNode(captured.nodes, 'Contract action')
          assert.ok(action, `${id}: event action should remain visible`)
          await action.props.onClick(clickEvent())
          assert.ok(callbacks.some(([kind, actionId]) => kind === 'action' && actionId === 'contract-action'), `${id}: event action id was not forwarded`)
        }
        const fixedAction = id === 'bt-music' ? ['启动程序', 'open-player'] : id === 'dota2-typewriter' ? ['开始', 'start'] : null
        if (fixedAction) {
          const action = actionNode(captured.nodes, fixedAction[0])
          assert.ok(action, `${id}: primary action is missing`)
          await action.props.onClick(clickEvent())
          assert.ok(callbacks.some(([kind, actionId]) => kind === 'action' && actionId === fixedAction[1]))
        }
      }
    })
  })
})

test('agent permission, SMS OTP and DSH states keep their React callback contracts', { skip: !SOURCE }, async () => {
  await withRuntime(async () => {
    const agent = await importPlugin('agent-notify', read(packagePath('agent-notify', 'ui.mjs')))
    const decisions = []
    const permission = { ...eventFor('agent-notify'), event_type: 'agent-notify.permission', payload: { requestId: 'request-7', entry: { sessionTitle: 'Permission session', permission: { toolName: 'Bash', toolInput: { command: 'echo contract' } } } } }
    const approval = renderCaptured(agent.default, { event: permission, onClose: () => decisions.push(['close']), onAction: (id) => decisions.push(['action', id]) })
    assert.match(approval.html, /echo contract/)
    const allow = actionNode(approval.nodes, '允许')
    assert.ok(allow, 'permission approval button missing')
    await allow.props.onClick(clickEvent())
    const deny = closeNode(approval.nodes)
    assert.ok(deny, 'permission close/deny control missing')
    await deny.props.onClick(clickEvent())
    assert.ok(decisions.some(([kind, id]) => kind === 'action' && id === 'allow:request-7'))
    assert.ok(decisions.some(([kind, id]) => kind === 'action' && id === 'deny:request-7'))
    assert.ok(decisions.some(([kind]) => kind === 'close'))

    const sms = await importPlugin('smsforwarder-notify', read(packagePath('smsforwarder-notify', 'ui.mjs')))
    const smsActions = []
    const otp = { ...eventFor('smsforwarder-notify'), actions: [{ id: 'copy-otp', label: '复制验证码' }], payload: { title: 'Contract OTP', noticeKind: 'otp', otp: '123456', appName: 'Contract SMS' } }
    const message = renderCaptured(sms.default, { event: otp, onClose() {}, onAction: (id) => smsActions.push(id) })
    assert.match(message.html, /123456/)
    const copy = actionNode(message.nodes, '复制验证码')
    assert.ok(copy, 'SMS OTP copy action missing')
    await copy.props.onClick(clickEvent())
    assert.deepEqual(smsActions, ['copy-otp'])

    const dsh = await importPlugin('dsh-chat', read(packagePath('dsh-chat', 'ui.mjs')))
    for (const [status, label] of [['running', '进行中'], ['done', '已完成'], ['waiting', '等你处理'], ['error', '处理失败']]) {
      let closed = false
      const event = { ...eventFor('dsh-chat'), event_type: 'dsh-chat.notice', payload: { notice: true, status, sessionId: 'contract-session', preview: 'Contract preview' } }
      const notice = renderCaptured(dsh.default, { event, onClose: () => { closed = true }, onAction() {} })
      assert.ok(notice.html.includes(label), `DSH ${status} label missing`)
      assert.match(notice.html, /Contract preview/)
      const close = closeNode(notice.nodes)
      assert.ok(close, `DSH ${status} close action missing`)
      await close.props.onClick(clickEvent())
      assert.equal(closed, true)
    }
  })
})

test('timer rule, color-input and audio fields survive the real source wrapper', { skip: !SOURCE }, async () => {
  await withRuntime(async () => {
    const timer = await importPlugin('timer', read(packagePath('timer', 'settings.mjs')), ['createRule', 'portableSettings', 'ensureBuiltinEyeRule', 'compareRules', 'isEyeRule', 'colorInputValue'])
    const settings = { enabled: true, rules: [timer.createRule({ id: 'daily', mode: 'daily', daily_times: ['9:00', '09:00', '25:00', '18:20'], sticky: true, sound_enabled: true, sound_volume: 0, sound_path: '/memory/notify.wav', accent_color: '#abc' }), timer.createRule({ id: 'off', enabled: false }), timer.createRule({ id: 'fast', interval_minutes: 5 })] }
    timer.ensureBuiltinEyeRule(settings)
    const portable = timer.portableSettings(settings)
    assert.equal(portable.rules.filter(timer.isEyeRule).length, 1)
    assert.equal(portable.rules[0].title, '护眼提醒')
    assert.equal(portable.rules[0].reset_on_rest, true)
    const daily = portable.rules.find((rule) => rule.id === 'daily')
    assert.deepEqual(daily.daily_times, ['09:00', '18:20'])
    assert.equal(daily.sticky, true)
    assert.equal(daily.sound_enabled, true)
    assert.equal(daily.sound_volume, 0)
    assert.equal(daily.sound_path, '/memory/notify.wav')
    assert.equal(daily.accent_color, '#abc')
    assert.equal(daily.last_fired_at, null)
    const sorted = [...portable.rules].sort(timer.compareRules)
    assert.equal(sorted[0].id, 'fast')
    assert.equal(sorted.at(-1).id, 'off')
    assert.match(timer.colorInputValue(''), /^#[a-f\d]{6}$/i, 'native color inputs cannot receive rewritten CSS variables')
    assert.equal(timer.colorInputValue('#abc'), '#aabbcc')
  })
})

test('heatmap date/minute/block and notify interval helpers retain data semantics', { skip: !SOURCE }, async () => {
  await withRuntime(async () => {
    const heatmap = await importPlugin('heatmap', read(packagePath('heatmap', 'settings.mjs')), ['densify', 'mergeBlocks', 'startOfLocalDay', 'parseYmd', 'ymd'])
    const date = heatmap.parseYmd('2026-11-08')
    assert.equal(heatmap.ymd(date), '2026-11-08')
    assert.equal(heatmap.parseYmd('2026-02-31'), null)
    const from = heatmap.startOfLocalDay(date)
    const dense = heatmap.densify(from, [{ timestamp: from, active: true }, { timestamp: from + 60, active: false }, { timestamp: from + 120, active: false }])
    assert.equal(dense.length, 1440)
    const blocks = heatmap.mergeBlocks(dense)
    assert.equal(blocks.length, 3)
    assert.equal(blocks[1].mins, 2)
    assert.equal(blocks[2].active, null)
    const notify = await importPlugin('notify-demo', read(packagePath('notify-demo', 'settings.mjs')), ['clamp', 'portable'])
    assert.equal(notify.clamp(1), 50)
    assert.equal(notify.clamp(999999999), 86400000)
    const cfg = notify.portable({ intervalMs: 1500, onlyWhenActive: false, title: ' demo ', body: ' {count} ' })
    assert.equal(cfg.intervalMs, 1500)
    assert.equal(cfg.onlyWhenActive, false)
    assert.equal(cfg.body, '{count}')
  })
})
