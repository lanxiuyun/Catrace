import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Execute production TS/TSX, not a second implementation. Only UI primitives,
// hook scheduling, measurements and host I/O are substituted; no browser/native I/O.
const root = new URL('../', import.meta.url)
const source = path => readFileSync(new URL(path, root), 'utf8')
const compiled = new Map()
const plain = value => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const primitive = ({ children }) => React.createElement('div', null, children)
const compound = () => Object.assign(primitive.bind(null), {
  Track: primitive, Fill: primitive, Thumb: primitive, Trigger: primitive,
  Value: primitive, Indicator: primitive, Popover: primitive,
  Item: primitive, ItemIndicator: primitive,
})
const HeroUI = {
  Button: ({ children, variant, size, ...props }) => React.createElement('button', props, children),
  Input: primitive, TextArea: primitive, Select: compound(), ListBox: compound(), Slider: compound(),
}

function hooks() {
  const slots = []
  let cursor = 0, effects = []
  return {
    begin() { cursor = 0 },
    commit() { const pending = effects; effects = []; pending.forEach(run => run()) },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
    api: {
      useState(initial) {
        const index = cursor++
        slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
        return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
      },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
      useMemo(fn) { cursor++; return fn() },
      useEffect(fn, deps) {
        const index = cursor++, previous = slots[index]
        if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
          slots[index] = { deps }
          effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn() })
        }
      },
    },
  }
}

function harness(locale = 'en-US', apiOverrides = {}) {
  const modules = new Map(), instances = new Map(), timers = new Map(), observers = []
  let active, nextTimer = 0
  const react = { ...React }
  for (const name of ['useState', 'useRef', 'useMemo', 'useEffect']) react[name] = (...args) => active.api[name](...args)
  react.useLayoutEffect = react.useEffect
  const unexpected = () => { throw new Error('Unexpected host/native call') }
  const schedule = fn => { const id = ++nextTimer; timers.set(id, fn); return id }
  const cancel = id => timers.delete(id)
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this) }
    observe(target) { this.targets.push(target) }
    disconnect() { this.disconnected = true }
  }
  let api
  const dependencies = {
    react, 'react/jsx-runtime': jsxRuntime, '@heroui/react': HeroUI,
    'lucide-react': { Send: primitive, Lock: primitive, Unlock: primitive },
    '@tauri-apps/api/core': { invoke: unexpected, Channel: class {} },
    '@tauri-apps/plugin-updater': { Update: class {} },
    '@tauri-apps/api/webviewWindow': { getCurrentWebviewWindow: unexpected },
  }
  const messages = () => evaluate(`src/i18n/locales/${locale}.ts`).default
  const t = key => key.split('.').reduce((node, part) => node?.[part], messages()) ?? key
  function evaluate(path) {
    if (modules.has(path)) return modules.get(path)
    const exports = {}
    if (!compiled.has(path)) compiled.set(path, ts.transpileModule(source(path), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText)
    runInNewContext(compiled.get(path), {
      exports, console, ResizeObserver,
      setTimeout: schedule, clearTimeout: cancel, setInterval: schedule, clearInterval: cancel,
      require(id) {
        if (id.endsWith('.css')) return {}
        if (Object.hasOwn(dependencies, id)) return dependencies[id]
        if (!id.startsWith('.')) throw new Error(`Unexpected import ${id} in ${path}`)
        const url = new URL(id, new URL(path, root))
        const resolved = ['.ts', '.tsx'].map(extension => new URL(url.href + extension)).find(candidate => existsSync(candidate))
        assert.ok(resolved, `Resolve ${id} from ${path}`)
        const relative = resolved.href.slice(root.href.length)
        if (relative === 'src/api/tauri.ts' && api) return api
        if (relative === 'src/app/i18n.ts') return { useT: () => t }
        if (relative === 'src/app/store.ts') return { useShellStore: select => select({ locale }) }
        if (relative === 'src/app/ui/toast.ts') return { showToast: unexpected }
        if (relative.endsWith('/PluginCenter.tsx')) return { PluginCenter: primitive }
        if (relative.endsWith('/PluginSettingRow.tsx')) return { PluginSettingRow: primitive }
        return evaluate(relative)
      },
    }, { filename: path })
    modules.set(path, exports)
    return exports
  }
  api = { ...evaluate('src/api/tauri.ts'), ...apiOverrides }
  return {
    evaluate, api, observers, t,
    render(path, name, props = {}, key = path) {
      active = instances.get(key) ?? hooks(); instances.set(key, active); active.begin()
      return evaluate(path)[name](props)
    },
    commit(key) { instances.get(key).commit() },
    unmount(key) { instances.get(key).unmount() },
    runTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()) },
  }
}

function descendants(node) {
  if (!React.isValidElement(node)) return []
  return [node, ...React.Children.toArray(node.props.children).flatMap(descendants)]
}
const byClass = (tree, name) => descendants(tree).find(node => node.props.className?.split(' ').includes(name))
const scenePath = 'src/components/FullscreenReminderScene.tsx'
const previewPath = 'src/components/FullscreenReminderPreview.tsx'
const settingsPath = 'src/app/pages/plugins/RestSettings.tsx'
const pluginsPath = 'src/app/pages/Plugins.tsx'
const windowPath = 'src/app/windows/ReminderFullscreen.tsx'
const model = h => h.evaluate('src/components/fullscreenReminderModel.ts')
const sceneProps = h => ({ title: 'Local title', body: 'Local body', bgImage: 'data:image/png;base64,test', opacity: 35, fitMode: 'contain', remainingSeconds: 125, elementTransforms: model(h).readFullscreenTransforms() })
const scene = (h, props = {}) => h.render(scenePath, 'FullscreenReminderScene', { ...sceneProps(h), ...props })
const childOfType = (tree, type) => descendants(tree).find(node => node.type === type)

for (const fitMode of ['contain', 'cover', 'fill']) {
  test(`scene renders separate blurred/sharp layers with opacity and ${fitMode} sizing`, () => {
    const h = harness(), tree = scene(h, { fitMode })
    const background = byClass(tree, 'reminder-fullscreen-bg'), sharp = byClass(tree, 'reminder-fullscreen-sharp')
    assert.ok(background && sharp)
    assert.notEqual(background, sharp)
    for (const layer of [background, sharp]) {
      assert.equal(layer.props.style.backgroundImage, 'url(data:image/png;base64,test)')
      assert.equal(layer.props.style.opacity, 0.35)
    }
    assert.equal(sharp.props.style.backgroundSize, fitMode === 'fill' ? '100% 100%' : fitMode)
    assert.equal(tree.props.style?.opacity, undefined, 'opacity must not fade foreground content')
    const html = renderToStaticMarkup(tree)
    assert.match(html, /Local title/); assert.match(html, /Local body/); assert.match(html, /02:05/)
    for (const key of ['countdown', 'snooze5', 'snooze10', 'skip']) assert.ok(html.includes(h.t(`reminder.${key}`)))
  })
}

test('zero opacity hides both image layers, not content; no image omits both layers', () => {
  const h = harness(), tree = scene(h, { opacity: 0 })
  for (const name of ['reminder-fullscreen-bg', 'reminder-fullscreen-sharp']) assert.equal(byClass(tree, name).props.style.opacity, 0)
  assert.match(renderToStaticMarkup(tree), /Local title/)
  const empty = scene(h, { bgImage: '' })
  assert.equal(byClass(empty, 'reminder-fullscreen-bg'), undefined)
  assert.equal(byClass(empty, 'reminder-fullscreen-sharp'), undefined)
  assert.match(renderToStaticMarkup(empty), /02:05/)
})

test('saved transforms use real defaults, reject invalid fields and render all four elements', () => {
  const h = harness(), m = model(h)
  const saved = JSON.stringify({ title: { x: 27, y: 31, scale: 1.4, rotate: -17 }, body: { x: 66 }, countdown: { y: 72, scale: 'wrong' }, actions: { rotate: 23 } })
  const transforms = m.readFullscreenTransforms(saved)
  assert.equal(transforms.title.x, 27); assert.equal(transforms.body.x, 66)
  assert.equal(transforms.countdown.scale, h.api.DEFAULT_ELEMENT_TRANSFORMS.countdown.scale)
  const wrappers = descendants(scene(h, { elementTransforms: transforms })).filter(node => node.props.className === 'reminder-fullscreen-editable-element')
  assert.equal(wrappers.length, 4)
  for (const [i, name] of ['title', 'body', 'countdown', 'actions'].entries()) {
    const value = transforms[name]
    assert.equal(wrappers[i].props.style.left, `${value.x}%`)
    assert.equal(wrappers[i].props.style.top, `${value.y}%`)
    assert.equal(wrappers[i].props.style.transform, `translate(-50%, -50%) scale(${value.scale}) rotate(${value.rotate}deg)`)
  }
  for (const invalid of ['not JSON', 'null', '42', '{"title":{"x":1e999,"y":"wrong"}}']) assert.deepEqual(plain(m.readFullscreenTransforms(invalid)), plain(h.api.DEFAULT_ELEMENT_TRANSFORMS))
  const fresh = m.readFullscreenTransforms(); fresh.title.x = 99
  assert.equal(m.readFullscreenTransforms().title.x, h.api.DEFAULT_ELEMENT_TRANSFORMS.title.x)
  assert.equal(m.formatFullscreenTime(0), '00:00')
})

test('scene supplies snooze/skip callbacks and allows the native controller to wrap elements', () => {
  const h = harness(), calls = [], names = []
  const tree = scene(h, {
    onSnooze: minutes => calls.push(minutes), onSkip: () => calls.push('skip'),
    renderElement: (name, content) => { names.push(name); return React.createElement('section', { 'data-element': name }, content) },
  })
  let stopped = 0
  descendants(tree).filter(node => node.type === HeroUI.Button).forEach(button => button.props.onClick({ stopPropagation() { stopped++ } }))
  assert.deepEqual(calls, [5, 10, 'skip']); assert.equal(stopped, 3)
  assert.deepEqual(names, ['title', 'body', 'countdown', 'actions'])
  assert.equal(byClass(tree, 'reminder-fullscreen-editable-element'), undefined)
})

test('preview is inert/aria-hidden, scales on observation and disconnects on unmount', () => {
  const h = harness(), props = sceneProps(h)
  let tree = h.render(previewPath, 'FullscreenReminderPreview', props)
  const viewport = byClass(tree, 'ct-fullscreen-preview'), canvas = byClass(tree, 'ct-fullscreen-preview-canvas')
  assert.equal(viewport.props.role, 'img'); assert.equal(viewport.props['aria-label'], h.t('plugins.rest.fullscreenPreviewLabel'))
  assert.equal(canvas.props.inert, true); assert.equal(canvas.props['aria-hidden'], 'true')
  assert.equal(canvas.props.style.visibility, 'hidden')
  const child = childOfType(tree, h.evaluate(scenePath).FullscreenReminderScene)
  assert.deepEqual(plain(child.props), plain(props))
  for (const prop of ['renderElement', 'onSkip', 'onSnooze']) assert.equal(child.props[prop], undefined)
  const host = { clientWidth: 480 }, measured = { offsetWidth: 1920 }
  viewport.props.ref.current = host; canvas.props.ref.current = measured
  h.commit(previewPath)
  assert.equal(h.observers.length, 1); assert.deepEqual(h.observers[0].targets, [host, measured])
  tree = h.render(previewPath, 'FullscreenReminderPreview', props)
  assert.equal(byClass(tree, 'ct-fullscreen-preview-canvas').props.style.transform, 'scale(0.25)')
  assert.equal(byClass(tree, 'ct-fullscreen-preview-canvas').props.style.visibility, 'visible')
  host.clientWidth = 960; h.observers[0].callback()
  tree = h.render(previewPath, 'FullscreenReminderPreview', props)
  assert.equal(byClass(tree, 'ct-fullscreen-preview-canvas').props.style.transform, 'scale(0.5)')
  measured.offsetWidth = 0; h.observers[0].callback()
  tree = h.render(previewPath, 'FullscreenReminderPreview', props)
  assert.equal(byClass(tree, 'ct-fullscreen-preview-canvas').props.style.visibility, 'hidden')
  h.commit(previewPath); assert.equal(h.observers.length, 1)
  h.unmount(previewPath); assert.equal(h.observers[0].disconnected, true)
})

function settingsProps(extra = {}) {
  return { enabled: true, config: { window_minutes: 45, break_minutes: 7, snooze_interval_minutes: 3 }, mode: 'fullscreen', fullscreen: { bg: 'local-image', opacity: 0, fitMode: 'fill', elementTransforms: '{"title":{"x":22,"rotate":13}}' }, text: { title: 'Unsaved title', body: 'Unsaved body' }, testing: false, ...extra }
}

test('settings preview consumes current local text, duration, image, zero opacity, fit and saved layout', () => {
  const h = harness(), props = settingsProps()
  const tree = h.render(settingsPath, 'RestSettings', props)
  const preview = childOfType(tree, h.evaluate(previewPath).FullscreenReminderPreview)
  assert.ok(preview)
  assert.equal(preview.props.title, props.text.title); assert.equal(preview.props.body, props.text.body)
  assert.equal(preview.props.remainingSeconds, 420); assert.equal(preview.props.bgImage, 'local-image')
  assert.equal(preview.props.opacity, 0); assert.equal(preview.props.fitMode, 'fill')
  assert.equal(preview.props.elementTransforms.title.x, 22); assert.equal(preview.props.elementTransforms.title.rotate, 13)
  const toast = h.render(settingsPath, 'RestSettings', { ...props, mode: 'toast' })
  assert.equal(childOfType(toast, h.evaluate(previewPath).FullscreenReminderPreview), undefined)
})

for (const locale of ['zh-CN', 'en-US']) {
  test(`empty settings text matches actual Rust notification defaults (${locale})`, () => {
    const h = harness(locale), rust = source('src-tauri/src/rest_plugin.rs')
    const rustDefault = name => {
      const body = rust.match(new RegExp(`fn ${name}\\([^]*?\\n\\}`))?.[0]
      assert.ok(body, `Rust ${name} exists`)
      const match = body.match(locale === 'zh-CN' ? /"zh-CN"\s*=>\s*"([^"]*)"/ : /_\s*=>\s*"([^"]*)"/)
      assert.ok(match); return match[1]
    }
    const tree = h.render(settingsPath, 'RestSettings', settingsProps({ text: { title: '', body: '' } }))
    const preview = childOfType(tree, h.evaluate(previewPath).FullscreenReminderPreview)
    assert.equal(preview.props.title, rustDefault('notify_title'))
    assert.equal(preview.props.body, rustDefault('notify_body'))
    assert.equal(preview.props.body, rustDefault('test_notify_msg'))
  })
}

test('Plugins reloads zero opacity and saved layout, keeps local edits live and preserves layout on save', async () => {
  const saves = [], serialized = '{"title":{"x":23,"scale":1.3}}'
  const h = harness('en-US', {
    getConfig: async () => ({ enabled: true, window_minutes: 45, break_minutes: 8, snooze_interval_minutes: 3 }),
    getReminderMode: async () => 'fullscreen',
    getFullscreenSettings: async () => ({ bg_image: 'saved-image', opacity: 0, fit_mode: 'cover', element_transforms: serialized }),
    getReminderText: async () => ({ title: 'Saved title', body: 'Saved body' }),
    setFullscreenSettings: async (...args) => saves.push(args),
  })
  h.render(pluginsPath, 'Plugins'); h.commit(pluginsPath); await flush()
  const settings = () => childOfType(h.render(pluginsPath, 'Plugins'), h.evaluate(settingsPath).RestSettings)
  let current = settings()
  assert.equal(current.props.fullscreen.opacity, 0); assert.equal(current.props.fullscreen.elementTransforms, serialized)
  current.props.onUpdateFullscreen({ opacity: 55, fitMode: 'fill' })
  current = settings()
  assert.equal(current.props.fullscreen.opacity, 55); assert.equal(current.props.fullscreen.fitMode, 'fill')
  assert.equal(current.props.fullscreen.elementTransforms, serialized)
  assert.equal(saves.length, 0, 'local preview updates before debounced persistence')
  h.runTimers(); await flush()
  assert.deepEqual(saves, [['saved-image', 55, 'fill', '']])
  const rust = source('src-tauri/src/lib.rs')
  assert.match(rust, /if !element_transforms\.is_empty\(\)\s*\{\s*db\.set_setting\("fullscreen_element_transforms", &element_transforms\)/, 'empty transform argument preserves the backend layout')
  h.unmount(pluginsPath)
})

test('native fullscreen controller feeds the shared scene saved transforms and zero opacity', async () => {
  const saved = '{"body":{"x":37,"y":42,"scale":1.2,"rotate":9}}', saves = []
  const h = harness('en-US', {
    getReminderData: async () => ({ title: 'Real title', body: 'Real body', boundary: 100, break_minutes: 4, fullscreen_bg: 'saved-image', fullscreen_opacity: 0, fullscreen_fit_mode: 'cover', fullscreen_element_transforms: saved }),
    setFullscreenSettings: async (...args) => saves.push(args),
  })
  h.render(windowPath, 'default'); h.commit(windowPath); await flush()
  const tree = h.render(windowPath, 'default')
  const shared = childOfType(tree, h.evaluate(scenePath).FullscreenReminderScene)
  assert.equal(shared.props.title, 'Real title'); assert.equal(shared.props.body, 'Real body')
  assert.equal(shared.props.opacity, 0); assert.equal(shared.props.fitMode, 'cover'); assert.equal(shared.props.remainingSeconds, 240)
  assert.equal(shared.props.elementTransforms.body.x, 37); assert.equal(shared.props.elementTransforms.body.rotate, 9)
  for (const callback of ['renderElement', 'onSkip', 'onSnooze']) assert.equal(typeof shared.props[callback], 'function')
  h.unmount(windowPath); await flush()
  assert.ok(saves.length > 0)
  assert.equal(saves.at(-1)[1], 0)
  assert.equal(JSON.parse(saves.at(-1)[3]).body.x, 37)
})


for (const changeBeforeRestore of [false, true]) {
  test(`cleared background reloads bundled default without overwriting a newer selection (${changeBeforeRestore})`, async () => {
    let reads = 0, finishRestore
    const h = harness('en-US', {
      getConfig: async () => ({ window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3 }),
      getReminderMode: async () => 'fullscreen',
      getFullscreenSettings: async () => {
        if (++reads === 1) return { bg_image: 'custom', opacity: 80, fit_mode: 'contain', element_transforms: '' }
        return new Promise(resolve => { finishRestore = resolve })
      },
      getReminderText: async () => ({ title: '', body: '' }),
      setFullscreenSettings: async () => {},
    })
    h.render(pluginsPath, 'Plugins'); h.commit(pluginsPath); await flush()
    const settings = () => childOfType(h.render(pluginsPath, 'Plugins'), h.evaluate(settingsPath).RestSettings)
    settings().props.onUpdateFullscreen({ bg: '' })
    h.runTimers(); await flush()
    assert.equal(typeof finishRestore, 'function')
    if (changeBeforeRestore) settings().props.onUpdateFullscreen({ bg: 'new-choice' })
    finishRestore({ bg_image: 'bundled-default' }); await flush()
    assert.equal(settings().props.fullscreen.bg, changeBeforeRestore ? 'new-choice' : 'bundled-default')
    h.unmount(pluginsPath); await flush()
  })
}

test('whitespace-only text is custom, matching the native reminder empty-string contract', () => {
  const h = harness('zh-CN')
  const tree = h.render(settingsPath, 'RestSettings', settingsProps({ text: { title: ' ', body: '  ' } }))
  const preview = childOfType(tree, h.evaluate(previewPath).FullscreenReminderPreview)
  assert.equal(preview.props.title, ' ')
  assert.equal(preview.props.body, '  ')
})
