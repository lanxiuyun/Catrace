import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import * as HeroUI from '@heroui/react'
import * as icons from 'lucide-react'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const source = path => readFileSync(new URL(path, root), 'utf8')
function loader(react = React) {
  const cache = new Map()
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    const exports = {}
    const code = ts.transpileModule(source(path), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    runInNewContext(code, { exports, console, require(id) {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return jsxRuntime
      if (id === '@heroui/react') return HeroUI
      if (id === 'lucide-react') return icons
      if (id === 'react-dom') return { createPortal() { throw new Error('Unexpected portal during card render') } }
      if (id.endsWith('.css')) return {}
      if (id.endsWith('/i18n')) return { useT: () => key => key }
      if (id.endsWith('/store')) return { useShellStore: select => select({ locale: 'zh-CN' }) }
      // The special-day toast itself is outside this container migration.
      if (id.endsWith('/SpecialDayToastCard')) return { default: () => null }
      assert.ok(id.startsWith('.'), `Unexpected dependency ${id}`)
      const url = new URL(id, new URL(path, root))
      const resolved = ['.ts', '.tsx'].map(extension => new URL(url.href + extension)).find(existsSync)
      assert.ok(resolved, `Resolve ${id}`)
      return load(resolved.href.slice(root.href.length))
    } }, { filename: path })
    cache.set(path, exports)
    return exports
  }
  return load
}
const descendants = node => React.isValidElement(node)
  ? [node, ...React.Children.toArray(node.props.children).flatMap(descendants)] : []

for (const [path, name, props, className, tag] of [
  ['src/components/SettingsCard.tsx', 'SettingsCard', { title: 'Group', children: 'Rows' }, null, 'div'],
  ['src/app/pages/settings/SettingsCard.tsx', 'SettingsCard', { label: 'System', children: 'Controls' }, 'ct-settings-card', 'div'],
  ['src/app/pages/debug/DebugPanel.tsx', 'DebugPanel', { title: 'Status', meta: 'Meta', children: 'Content' }, 'ct-debug-panel', 'section'],
  ['src/app/pages/debug/SpecialDayPreview.tsx', 'SpecialDayPreview', {}, 'ct-debug-panel', 'section'],
]) {
  test(`${path} renders a real HeroUI Card and preserves its content/semantics`, () => {
    const component = loader()(path)[name]
    const html = renderToStaticMarkup(React.createElement(component, props))
    assert.match(html, new RegExp(`<${tag}[^>]*data-slot="card"`))
    assert.ok(html.includes('card--default'))
    if (className) assert.ok(html.includes(className))
    if (props.children) assert.ok(html.includes(props.children))
    if (name === 'DebugPanel') {
      const id = html.match(/aria-labelledby="([^"]+)"/)[1]
      assert.ok(html.includes(`id="${id}"`))
    }
    if (className === null) {
      // 久坐提醒设置卡：纯 HeroUI Card，不挂任何自定义类；分组标题在卡片外，字号照 agent-notify。
      assert.doesNotMatch(html, /ct-/)
      assert.match(html, /<h3[^>]*>Group<\/h3>/)
      assert.ok(html.indexOf('Group') < html.indexOf('data-slot="card"'))
    }
  })
}

test('plugin settings cards keep no custom stylesheet', () => {
  assert.equal(existsSync(new URL('../src/components/SettingsCard.css', import.meta.url)), false)
  assert.doesNotMatch(source('src/components/SettingsCard.tsx'), /\.css'/)
})

test('HeroUI cards share the app card background token', () => {
  const theme = source('src/styles/theme.css')
  assert.match(theme, /--ct-card-bg:\s*#fbfbfb/)
  assert.match(theme, /\[data-theme='dark'\][\s\S]*?--ct-card-bg:\s*#2b2b2b/)
  assert.match(source('src/app/base.css'), /\.card--default\s*\{[^}]*background-color:\s*var\(--ct-card-bg\)/)
  for (const [path, selector] of [
    ['src/app/pages/settings.css', '.ct-settings-card'],
    ['src/app/pages/dashboard.css', '.ct-dashboard .activity-panel'],
    ['src/app/pages/debug.css', '.ct-debug-panel'],
    ['src/app/pages/dashboard/timeline-windows.css', '.ct-timeline-windows .ct-activity-card'],
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rule = source(path).match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
    assert.ok(rule, `${path} defines ${selector}`)
    assert.match(rule[1], /var\(--ct-card-bg\)/, `${selector} uses the card background token`)
  }
})

test('activity cards retain summary button, matching detail IDs and expand/collapse with HeroUI containers', () => {
  const slots = []; let cursor = 0
  const react = { ...React,
    useMemo: fn => fn(), useRef: value => ({ current: value }),
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
  }
  const Timeline = loader(react)('src/app/pages/dashboard/TimelineWindows.tsx').TimelineWindows
  const now = Math.floor(Date.now() / 60000) * 60
  const minutes = Array.from({ length: 60 }, (_, i) => ({ ts: now - (59 - i) * 60, active: true }))
  const render = () => { cursor = 0; return Timeline({ minutes, windowMinutes: 45, breakMinutes: 5 }) }
  let tree = render()
  const cards = descendants(tree).filter(node => node.type === HeroUI.Card)
  assert.equal(cards.length, 2)
  for (const card of cards) {
    const [button, detail] = React.Children.toArray(card.props.children)
    assert.equal(button.type, 'button'); assert.equal(button.props.type, 'button')
    assert.equal(button.props['aria-controls'], detail.props.id)
    assert.equal(button.props['aria-expanded'], false); assert.equal(detail.props['aria-hidden'], true)
    assert.match(renderToStaticMarkup(card), /data-slot="card"/)
  }
  assert.equal(cards[0].props.children[0].props.onClick, undefined, 'summary click bubbles to Card without double toggling')
  cards[0].props.onClick()
  tree = render()
  let button = descendants(tree).find(node => node.props.className === 'card-summary')
  assert.equal(button.props['aria-expanded'], true)
  assert.ok(descendants(tree).some(node => node.props.className === 'detail-body'))
  descendants(tree).find(node => node.type === HeroUI.Card).props.onClick()
  tree = render()
  button = descendants(tree).find(node => node.props.className === 'card-summary')
  assert.equal(button.props['aria-expanded'], false)
})

test('all migrated surfaces use HeroUI Card default padding without summary double-padding', () => {
  for (const [path, name] of [
    ['src/app/pages/debug.css', 'ct-debug-panel'],
    ['src/app/pages/settings.css', 'ct-settings-card'],
    ['src/app/pages/dashboard/timeline-windows.css', 'ct-activity-card'],
  ]) {
    const rules = [...source(path).matchAll(new RegExp(`\\.${name}(?=[\\s.:{])[^{}]*\\{([^}]+)\\}`, 'g'))]
    assert.ok(rules.length > 0)
    for (const rule of rules) {
      assert.doesNotMatch(rule[1], /\bpadding(?:-[\w-]+)?\s*:/, `${name} must inherit HeroUI padding`)
    }
  }
  const summary = source('src/app/pages/dashboard/timeline-windows.css').match(/\.card-summary \{([^}]+)\}/)[1]
  assert.match(summary, /padding: 0;/, 'summary must not add a second layer of card padding')
})
