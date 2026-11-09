import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import * as React from 'react'
import * as Radix from '@radix-ui/themes'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'src')
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
const obsolete = /^(?:(?:vue(?:-i18n|-router)?|pinia|naive-ui|@lucide\/vue|@vitejs\/plugin-vue|vue-tsc)(?:$|\/)|@vue\/)/

test('every application component and import uses the React-only source contract', () => {
  const sourceFiles = files(src)
  assert.deepEqual(sourceFiles.filter((path) => extname(path) === '.vue'), [])
  for (const path of sourceFiles.filter((path) => /\.(?:ts|tsx)$/.test(path))) {
    const text = readFileSync(path, 'utf8')
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier
        if (specifier && ts.isStringLiteral(specifier)) {
          assert.equal(obsolete.test(specifier.text), false, `${relative(root, path)} imports ${specifier.text}`)
          assert.equal(/\.vue$|(?:^|\/)legacy(?:\/|$)/.test(specifier.text), false, `${relative(root, path)} uses a removed bridge`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.equal(/__CATRACE_(?:VUE|NAIVE|UI)__/.test(text), false, `${relative(root, path)} injects a removed runtime`)
  }
})

test('dependencies and Vite no longer include a second component framework', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.equal(obsolete.test(name), false, `obsolete direct dependency ${name}`)
  }
  assert.equal(/(?:@vue\/|vue-i18n|vue-router|naive-ui|\bpinia\b|vue-tsc)/.test(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')), false)
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
  assert.equal(/@vitejs\/plugin-vue|\bvue\(\)/.test(vite), false)
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit')
})

test('plugin modules receive exactly the host React instance, Radix namespace and scoped API factory', () => {
  const source = readFileSync(join(src, 'plugins/pluginRuntime.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const api = (id) => ({ id })
  const dependencies = { react: React, '@radix-ui/themes': Radix, './pluginApi': { createPluginApi: api } }
  const context = { exports: {}, require(name) { assert.ok(name in dependencies); return dependencies[name] } }
  runInNewContext(compiled, context)
  context.exports.ensurePluginRuntime()
  assert.equal(context.__CATRACE_REACT__, React)
  assert.equal(context.__CATRACE_RADIX__, Radix)
  assert.equal(context.__CATRACE_CREATE_PLUGIN_API__, api)
  assert.deepEqual(context.__CATRACE_CREATE_PLUGIN_API__('timer'), { id: 'timer' })
  context.exports.ensurePluginRuntime()
  assert.equal(context.__CATRACE_REACT__, React)
  assert.equal(context.__CATRACE_VUE__, undefined)
  assert.equal(context.__CATRACE_NAIVE__, undefined)
})
