import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// 只编译真实模块：版本比较是纯函数，不需要 Tauri、网络、DOM 或 AppData。
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const load = () => {
  const exports = {}
  runInNewContext(compile('../src/app/pages/plugins/pluginUpdate.ts'), {
    exports,
    require(id) { throw new Error(`Unexpected dependency ${id}`) },
  })
  return exports
}

test('plugin versions compare by dotted numeric segments', () => {
  const { comparePluginVersions } = load()
  assert.ok(comparePluginVersions('26.11.13', '26.11.12') > 0)
  assert.ok(comparePluginVersions('26.12.0', '26.11.99') > 0)
  assert.ok(comparePluginVersions('27.0.0', '26.99.99') > 0)
  assert.ok(comparePluginVersions('26.11.12', '26.11.13') < 0)
  assert.equal(comparePluginVersions('26.11.12', '26.11.12'), 0)
  // 段数不同按缺省 0 处理，v 前缀 / 预发布 / 构建后缀不参与比较。
  assert.equal(comparePluginVersions('26.11', '26.11.0'), 0)
  assert.equal(comparePluginVersions('v26.11.13', '26.11.12'), 1)
  assert.equal(comparePluginVersions('26.11.13+build.7', '26.11.13'), 0)
  assert.equal(comparePluginVersions('26.11.13-rc1', '26.11.13'), 0)
})

test('the update cue only appears when the repository version is newer', () => {
  const { availablePluginUpdate } = load()
  assert.equal(availablePluginUpdate('26.11.12', '26.11.13'), '26.11.13')
  assert.equal(availablePluginUpdate('26.11.13', '26.11.13'), '')
  assert.equal(availablePluginUpdate('26.11.14', '26.11.13'), '')
  // 版本缺失（旧安装 / 清单损坏）时不提示，也不报错。
  assert.equal(availablePluginUpdate('', '26.11.13'), '')
  assert.equal(availablePluginUpdate('26.11.12', null), '')
  assert.equal(availablePluginUpdate(undefined, '26.11.13'), '')
})
