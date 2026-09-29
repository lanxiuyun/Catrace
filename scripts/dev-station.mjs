#!/usr/bin/env node
// Pick a git worktree ("station") and run `pnpm tauri dev` inside it, without cd-ing.
// Stations come from `git worktree list`, so new worktrees show up automatically.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import readline from 'node:readline'

const DEV_PORT = 1420

// ---------------------------------------------------------------- color & width
const colorOn = !process.env.NO_COLOR && Boolean(process.stdout.isTTY)
const paint = (code) => (s) => (colorOn ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const dim = paint('2')
const bold = paint('1')
const red = paint('31')
const green = paint('32')
const yellow = paint('33')
const cyan = paint('36')
const magenta = paint('35')
const bar = paint('7')

const ANSI_RE = /\x1b\[[0-9;]*m/g

// East-Asian wide glyphs take two cells — without this every column drifts.
function vwidth(s) {
  let w = 0
  for (const ch of String(s).replace(ANSI_RE, '')) {
    const c = ch.codePointAt(0)
    const wide = c >= 0x1100 && (
      c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6))
    w += wide ? 2 : 1
  }
  return w
}

const pad = (s, w) => s + ' '.repeat(Math.max(0, w - vwidth(s)))

function clip(s, w) {
  if (vwidth(s) <= w) return s
  let out = ''
  for (const ch of s) {
    if (vwidth(out) + vwidth(ch) > w - 1) break
    out += ch
  }
  return `${out}…`
}

// Keep lines strictly inside the terminal so nothing wraps (wrapping breaks redraw).
const termWidth = () => Math.max(40, Math.min(200, (process.stdout.columns || 100) - 1))

function usage(code = 1) {
  console.log(`Usage: pnpm station [<工位>] [-- <tauri dev 参数>]

在某个 git worktree 工位里起 dev，不用 cd。

  pnpm station             交互选择工位（↑↓ 或 j/k 移动，Enter 启动，q/Esc 取消）
  pnpm station notif       直接在 notif 工位起（工位名 = 目录名去掉 Catrace- 前缀，或分支名）
  pnpm station --dry-run   只打印工位状态，不启动
  pnpm station --plain     不交互，静态打印工位列表

工位列表实时取自 \`git worktree list\`，新建 worktree 后自动出现。`)
  process.exit(code)
}

function fail(msg) {
  console.error(`${red('[station]')} ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------- git facts
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

function slugOf(path, branch) {
  const stripped = basename(path).replace(/^catrace-?/i, '').toLowerCase()
  if (stripped && stripped !== 'catrace') return stripped
  return (branch ?? 'detached').toLowerCase()
}

function dirtyCount(path) {
  return git(['status', '--porcelain'], path).split(/\r?\n/).filter(Boolean).length
}

function missingBits(path) {
  const missing = []
  if (!existsSync(join(path, 'node_modules'))) missing.push('node_modules 未装')

  const pluginDir = join(path, 'tools', 'plugin-demo')
  // A half-initialised submodule holds only the .git pointer file — that is not content.
  const plugins = existsSync(pluginDir) ? readdirSync(pluginDir).filter((n) => n !== '.git') : []
  if (!plugins.length) {
    missing.push('submodule 未初始化')
  } else if (submoduleDrifted(path, pluginDir)) {
    missing.push('submodule 版本不符')
  }
  return missing
}

// Does the submodule checkout match the gitlink this branch records? `git submodule status`
// answers the same question, but it walks the submodule (~1.5s per worktree here); two
// rev-parse calls do it in ~60ms.
function submoduleDrifted(path, pluginDir) {
  try {
    const recorded = git(['rev-parse', 'HEAD:tools/plugin-demo'], path).trim()
    const actual = git(['rev-parse', 'HEAD'], pluginDir).trim()
    return Boolean(recorded) && Boolean(actual) && recorded !== actual
  } catch {
    return false // unreadable submodule — launch-time alignment will sort it out
  }
}

// Newest mtime under src/ and src-tauri/ (build output excluded).
function newestSourceMtime(root) {
  let newest = 0
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'target' || e.name === 'node_modules') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p, depth + 1)
      } else {
        try {
          const m = statSync(p).mtimeMs
          if (m > newest) newest = m
        } catch {
          /* unreadable entry — ignore */
        }
      }
    }
  }
  for (const r of [join(root, 'src'), join(root, 'src-tauri')]) walk(r, 0)
  return newest
}

// A dev launch records the revision it started from, so the next listing knows whether the
// built exe still matches HEAD. mtimes alone lie — `cargo check` touches the exe.
const BUILD_MARKER = join(tmpdir(), 'catrace-station-builds.json')

function readMarkers() {
  try {
    return JSON.parse(readFileSync(BUILD_MARKER, 'utf8'))
  } catch {
    return {}
  }
}

function markLaunched(station) {
  const all = readMarkers()
  all[norm(station.path)] = { sha: station.sha, branch: station.branch, at: Date.now() }
  try {
    writeFileSync(BUILD_MARKER, JSON.stringify(all, null, 2))
  } catch {
    /* best effort — only powers the badge */
  }
}

// 'cold' = never built (574 crates, minutes, ~1-2G) · 'stale' = a rebuild will run before the
// window appears · 'warm' = nothing to compile.
function buildState(path, sha) {
  const debugDir = join(path, 'src-tauri', 'target', 'debug')
  let newestExe = 0
  try {
    for (const f of readdirSync(debugDir)) {
      if (!f.endsWith('.exe')) continue
      const m = statSync(join(debugDir, f)).mtimeMs
      if (m > newestExe) newestExe = m
    }
  } catch {
    return 'cold'
  }
  if (!newestExe) return 'cold'

  const mark = readMarkers()[norm(path)]
  if (!mark) return 'stale' // built before this launcher existed — assume it needs work
  if (mark.sha !== sha) return 'stale' // the exe comes from another revision
  return newestSourceMtime(path) > mark.at ? 'stale' : 'warm'
}

function listStations() {
  const out = git(['worktree', 'list', '--porcelain'])
  const stations = []
  let cur = null
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) stations.push(cur)
      cur = { path: line.slice('worktree '.length).trim() }
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.sha = line.slice('HEAD '.length).trim()
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    } else if (line === 'detached') {
      cur.branch = null
    }
  }
  if (cur) stations.push(cur)
  for (const [i, s] of stations.entries()) {
    // The primary worktree (the repo root) stays addressable as `main` whatever branch it is
    // on — otherwise its slug would change with every PR branch and break muscle memory.
    s.slug = i === 0 ? 'main' : slugOf(s.path, s.branch)
    s.dirty = dirtyCount(s.path)
    s.missing = missingBits(s.path)
    s.build = buildState(s.path, s.sha)
  }
  return stations
}

// ---------------------------------------------------------------- rendering
function makeRow(stations, termW) {
  const slugW = Math.max(4, ...stations.map((s) => vwidth(s.slug)))
  const branchW = Math.min(34, Math.max(10, ...stations.map((s) => vwidth(s.branch ?? '(detached)'))))
  const here = norm(process.cwd())

  return (s, selected) => {
    const branch = s.branch ?? '(detached)'
    const prefix = selected ? ' › ' : '   '
    const head = `${prefix}${pad(s.slug, slugW)}  ${pad(branch, branchW)}  `
    const badges = []
    if (s.dirty) badges.push({ t: `${s.dirty} 项未提交`, c: yellow })
    for (const m of s.missing) badges.push({ t: m, c: red })
    if (s.build === 'cold') badges.push({ t: '需冷编译', c: magenta })
    else if (s.build === 'stale') badges.push({ t: '待重编', c: yellow })
    if (norm(s.path) === here) badges.push({ t: '当前目录', c: cyan })
    const badgesPlain = badges.length ? `  ${badges.map((b) => b.t).join(' · ')}` : ''
    const badgesColor = badges.length ? `  ${badges.map((b) => b.c(b.t)).join(dim(' · '))}` : ''
    const pathW = Math.max(10, termW - vwidth(head) - vwidth(badgesPlain) - 1)
    const path = clip(s.path, pathW)

    if (selected) return bar(bold(pad(head + pad(path, pathW) + badgesPlain, termW)))
    return prefix +
      cyan(pad(s.slug, slugW)) + '  ' +
      (s.branch ? green(pad(branch, branchW)) : yellow(pad(branch, branchW))) + '  ' +
      pad(path, pathW) + badgesColor
  }
}

function printTable(stations) {
  const termW = termWidth()
  const row = makeRow(stations, termW)
  console.log('')
  console.log(dim(`  Catrace 工位 · ${stations.length} 个 · ${process.cwd()}`))
  console.log('')
  for (const s of stations) console.log(row(s, false))
  console.log('')
}

function selectStation(stations) {
  return new Promise((resolve) => {
    const termW = termWidth()
    const row = makeRow(stations, termW)
    const stdin = process.stdin
    let index = Math.max(0, stations.findIndex((s) => norm(s.path) === norm(process.cwd())))
    let drawn = 0
    let escTimer = null

    const lines = () => {
      const out = ['', dim(`  Catrace 工位 · ${stations.length} 个 · ${process.cwd()}`), '']
      stations.forEach((s, i) => out.push(row(s, i === index)))
      out.push('', dim('  ↑↓ / j k 移动 · Enter 启动 dev · q / Esc 取消'), '')
      return out
    }

    const render = () => {
      const body = lines()
      const out = body.map((l) => `\x1b[2K${l}`).join('\n')
      if (drawn) process.stdout.write(`\x1b[${drawn}A`)
      process.stdout.write(`${out}\n`)
      drawn = body.length
    }

    const finish = (value) => {
      clearTimeout(escTimer)
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write('\x1b[?25h')
      if (drawn) process.stdout.write(`\x1b[${drawn}A`)
      process.stdout.write('\x1b[J')
      resolve(value)
    }

    const handle = (key) => {
      if (key === '\u0003' || key === 'q') return finish(null)
      if (key === '\r' || key === '\n') return finish(stations[index])
      if (key === '\u001b[A' || key === 'k') {
        index = (index - 1 + stations.length) % stations.length
        return render()
      }
      if (key === '\u001b[B' || key === 'j') {
        index = (index + 1) % stations.length
        return render()
      }
      const n = Number(key)
      if (Number.isInteger(n) && n >= 1 && n <= stations.length) {
        index = n - 1
        return render()
      }
      return undefined
    }

    const onData = (buf) => {
      const key = buf.toString('utf8')
      // A lone ESC may be the head of an arrow sequence: give the rest a moment.
      if (key === '\u001b') {
        escTimer = setTimeout(() => finish(null), 60)
        return
      }
      clearTimeout(escTimer)
      escTimer = null
      handle(key)
    }

    stdin.setRawMode(true)
    stdin.resume()
    process.stdout.write('\x1b[?25l')
    stdin.on('data', onData)
    render()
  })
}

function resolveByName(stations, key) {
  const k = key.trim()
  if (!k) fail('工位名不能为空')
  const lower = k.toLowerCase()
  const exact = stations.filter((s) =>
    [s.slug, s.branch ?? '', basename(s.path), norm(s.path)].some((v) => v?.toLowerCase() === lower))
  if (exact.length === 1) return exact[0]
  const hits = exact.length
    ? exact
    : stations.filter((s) => [s.slug, s.branch ?? ''].some((v) => v?.toLowerCase().includes(lower)))
  if (hits.length === 1) return hits[0]
  printTable(stations)
  fail(hits.length ? `「${k}」匹配到多个工位，用更完整的名字` : `没有叫「${k}」的工位`)
}

// ---------------------------------------------------------------- runtime
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (a) => {
    rl.close()
    resolve(a.trim())
  }))
}

function portBusy(port) {
  const probe = (host) => new Promise((resolve) => {
    const sock = createConnection({ host, port })
    const done = (busy) => {
      sock.destroy()
      resolve(busy)
    }
    sock.setTimeout(500)
    sock.on('connect', () => done(true))
    sock.on('timeout', () => done(false))
    sock.on('error', () => done(false))
  })
  return (async () => (await probe('::1')) || (await probe('127.0.0.1')))()
}

function run(station, extra) {
  markLaunched(station)
  console.log(`\n  ${green('→')} 在 ${cyan(station.path)} 起 dev${dim(`（${station.branch ?? 'detached'}）`)}\n`)
  const child = spawn('pnpm', ['tauri', 'dev', ...extra], {
    cwd: station.path,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

const argv = process.argv.slice(2)
if (argv.includes('-h') || argv.includes('--help')) usage(0)
const dryRun = argv.includes('--dry-run')
const plain = argv.includes('--plain')
// Everything else is a station name plus extra flags forwarded to `tauri dev`.
const args = argv.filter((a) => a !== '--dry-run' && a !== '--plain' && a !== '-h' && a !== '--help')

const stations = listStations()
if (!stations.length) fail('没有找到任何 worktree')

const interactive = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
let station
let extra = []

if (args.length) {
  station = resolveByName(stations, args[0])
  extra = args.slice(1).filter((a) => a !== '--')
} else if (dryRun) {
  printTable(stations)
  process.exit(0)
} else if (plain) {
  printTable(stations)
  process.exit(0)
} else if (!interactive) {
  printTable(stations)
  console.log(dim('  非交互环境：用 `pnpm station <工位名>` 指定要跑哪个\n'))
  process.exit(1)
} else {
  const picked = await selectStation(stations)
  if (!picked) {
    console.log(dim('  已取消'))
    process.exit(0)
  }
  station = picked
}

const busy = await portBusy(DEV_PORT)

const warnMissing = (list) => {
  console.error(`${yellow('[station]')} ⚠ 「${station.slug}」还差初始化：${red(list.join(' / '))}`)
  if (list.some((m) => m.startsWith('submodule'))) {
    console.error(`[station]    git -C "${station.path}" submodule update --init --recursive`)
  }
  if (list.includes('node_modules 未装')) {
    console.error(`[station]    pnpm -C "${station.path}" install`)
  }
}

const warnBusy = () => {
  console.error(`${yellow('[station]')} ⚠ ${DEV_PORT} 端口已被占用：大概另一个工位（或正式版）的 dev 正在跑。`)
  console.error('[station]    单实例插件会让新起的实例立刻退出 —— 先停掉那一个。')
}

if (dryRun) {
  if (station.missing.length) warnMissing(station.missing)
  if (busy) warnBusy()
  const tail = station.missing.length || busy ? dim('（上面有警告）') : ''
  console.log(`  ${green('→')} 「${cyan(station.slug)}」${cyan(station.path)}${dim(`（${station.branch ?? 'detached'}）`)}${tail}`)
  process.exit(0)
}

// `tauri dev` syncs plugins out of the submodule: an empty or stale one yields a
// plugin-less / wrong-version app, so align it rather than launching something misleading.
if (station.missing.some((m) => m.startsWith('submodule'))) {
  console.log(dim(`  正在对齐「${station.slug}」的 submodule …`))
  try {
    execFileSync('git', ['-C', station.path, 'submodule', 'update', '--init', '--recursive'], { stdio: 'inherit' })
  } catch (err) {
    console.error(`${yellow('[station]')} ⚠ submodule 初始化失败：${err.message}`)
  }
  station.missing = missingBits(station.path)
}

if (station.missing.length) warnMissing(station.missing)
if (busy) warnBusy()
if (station.build === 'cold') {
  console.log(dim('  ⓘ 这个工位还没有编译过：首次启动要编几分钟、约 1~2G 磁盘，之后都是增量'))
} else if (station.build === 'stale') {
  console.log(dim('  ⓘ 源码比上次编译新：启动会先增量编一会儿，再弹窗口'))
}

const blocked = station.missing.length > 0 || busy
if (!blocked) run(station, extra)
else if (interactive && /^y(es)?$/i.test(await ask(`${yellow('[station]')} 仍要起？[y/N] `))) run(station, extra)
else {
  console.log(dim('  已取消'))
  process.exit(0)
}
