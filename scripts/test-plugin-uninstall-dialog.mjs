/**
 * HeroUI 3.2.7 uninstall-dialog regression. Node development SSR only: no DOM,
 * browser, Tauri, server or extra dependencies. React SSR normally skips effects.
 * Before the first HeroUI import, capture React's real useEffect calls; execute
 * ONLY PressResponder's registration check after rendering. This reproduces that
 * diagnostic, not a browser mount, portal, focus trap or dialog interaction test.
 *
 * Run: node --test scripts/test-plugin-uninstall-dialog.mjs
 * Node's test runner isolates this file from other test files in its own process.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const ROOT = new URL('../', import.meta.url)
const PRESS_WARNING = 'A PressResponder was rendered without a pressable child. Either call the usePress hook, or wrap your DOM node with <Pressable> component.'
const sourcePath = new URL('src/app/pages/plugins/PluginCenter.tsx', ROOT)
const read = (url) => readFileSync(url, 'utf8').replace(/^\uFEFF/, '')

// Do not statically import React, react-dom/server, or HeroUI above this point:
// React's ESM named exports must observe the CJS hook spy on their FIRST import.
test('real HeroUI development registration check warns for triggerless root, not standalone Backdrop', async (t) => {
  const previousEnvironment = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const require = createRequire(import.meta.url)
  const React = require('react')
  const originalUseEffect = React.useEffect
  const effects = []
  React.useEffect = function captureUseEffect(effect, dependencies) {
    effects.push(effect)
    // Keep the real React dispatcher and hook order. Do not execute arbitrary
    // browser-dependent effects and do not substitute fake component types.
    return originalUseEffect(effect, dependencies)
  }
  t.after(() => {
    React.useEffect = originalUseEffect
    if (previousEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousEnvironment
  })

  const { AlertDialog, Button } = await import('@heroui/react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  assert.equal(readFileSync(new URL('package.json', ROOT), 'utf8').includes('"@heroui/react": "3.2.7"'), true,
    'This dependency-specific diagnostic regression targets HeroUI 3.2.7')
  const h = React.createElement
  const onOpenChange = () => {}
  const dialogContent = () => h(AlertDialog.Container, null,
    h(AlertDialog.Dialog, null,
      h(AlertDialog.CloseTrigger),
      h(AlertDialog.Header, null, h(AlertDialog.Heading, null, 'Uninstall plugin')),
      h(AlertDialog.Body, null, 'Remove this plugin?'),
      h(AlertDialog.Footer, null,
        h(Button, { slot: 'close', variant: 'tertiary' }, 'Cancel'),
        h(Button, { slot: 'close', variant: 'danger' }, 'Uninstall'))))

  const cases = [
    {
      name: 'old controlled AlertDialog root has no trigger: exact warning is reproduced',
      element: () => h(AlertDialog, { isOpen: false, onOpenChange },
        h(AlertDialog.Backdrop, null, dialogContent())),
      checks: 1,
      warnings: [PRESS_WARNING],
    },
    {
      name: 'real Button trigger registers with the root PressResponder: no warning',
      element: () => h(AlertDialog, { isOpen: false, onOpenChange },
        h(Button, { key: 'trigger' }, 'Open uninstall dialog'),
        h(AlertDialog.Backdrop, { key: 'overlay' }, dialogContent())),
      checks: 1,
      warnings: [],
    },
    {
      name: 'new controlled standalone Backdrop has no root PressResponder: no warning',
      element: () => h(AlertDialog.Backdrop, { isOpen: false, onOpenChange }, dialogContent()),
      checks: 0,
      warnings: [],
    },
  ]
  for (const scenario of cases) await t.test(scenario.name, () => {
    effects.length = 0
    const warnings = []
    const originalWarn = console.warn
    console.warn = (...args) => warnings.push(args)
    try {
      renderToStaticMarkup(scenario.element())
      assert.deepEqual(warnings, [], 'SSR alone must not be mistaken for executing mount effects')
      const registrationChecks = effects.filter((effect) => typeof effect === 'function'
        && Function.prototype.toString.call(effect).includes(PRESS_WARNING))
      assert.equal(registrationChecks.length, scenario.checks,
        'The hook spy must capture the actual PressResponder check; a silent spy failure must fail the positive control')
      for (const check of registrationChecks) check()
      assert.deepEqual(warnings, scenario.warnings.map((warning) => [warning]))
      // Its real ref marks the check as registered even after warning; replaying
      // this selected effect should not emit a second strict-mode diagnostic.
      for (const check of registrationChecks) check()
      assert.deepEqual(warnings, scenario.warnings.map((warning) => [warning]))
    } finally {
      console.warn = originalWarn
    }
  })
})

test('PluginCenter controls uninstall Backdrop directly and preserves inner close controls', () => {
  const source = read(sourcePath)
  const tree = ts.createSourceFile(fileURLToPath(sourcePath), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.equal(tree.parseDiagnostics.length, 0, 'PluginCenter TSX must parse')
  const openings = []
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) openings.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const tag = (node) => node.tagName.getText(tree)
  assert.equal(openings.filter((node) => tag(node) === 'AlertDialog').length, 0,
    'An external uninstall button must not leave a triggerless AlertDialog root/PressResponder')
  const backdrops = openings.filter((node) => tag(node) === 'AlertDialog.Backdrop')
  assert.equal(backdrops.length, 1, 'Expected one controlled uninstall Backdrop')
  const backdrop = backdrops[0]
  const attribute = (node, name) => node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(tree) === name)
  const expression = (attr) => attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined
  const isOpen = expression(attribute(backdrop, 'isOpen'))
  assert.equal(isOpen?.getText(tree), '!!removeId', 'Backdrop, not a DialogTrigger root, owns controlled isOpen')
  const onOpenChange = expression(attribute(backdrop, 'onOpenChange'))
  assert.ok(onOpenChange && ts.isArrowFunction(onOpenChange), 'Backdrop must own the controlled onOpenChange handler')
  assert.match(onOpenChange.getText(tree), /if\s*\(!open\)\s*setRemoveId\(null\)/,
    'Closing the Backdrop must clear the selected uninstall id')
  const subtree = []
  function collect(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) subtree.push(node)
    ts.forEachChild(node, collect)
  }
  collect(backdrop.parent)
  for (const required of ['AlertDialog.Container', 'AlertDialog.Dialog', 'AlertDialog.CloseTrigger']) {
    assert.equal(subtree.filter((node) => tag(node) === required).length, 1, `${required} must remain inside Backdrop`)
  }
  const closeButtons = subtree.filter((node) => tag(node) === 'Button'
    && attribute(node, 'slot')?.initializer?.getText(tree) === '"close"')
  assert.equal(closeButtons.length, 2, 'Cancel and confirm must retain their real HeroUI close slots')
  const confirm = closeButtons.find((node) => attribute(node, 'variant')?.initializer?.getText(tree) === '"danger"')
  assert.ok(confirm, 'The destructive confirm button must remain')
  assert.match(expression(attribute(confirm, 'onClick'))?.getText(tree) || '', /confirmUninstall\(removeId\)/,
    'Confirm must retain the existing uninstall action')
})
