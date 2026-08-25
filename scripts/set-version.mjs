#!/usr/bin/env node
// Sync app version across the 3 required files + Cargo.lock.
// Binary in/out so CRLF / LF / BOM stay untouched.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?$/
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage(code = 1) {
  console.log(`Usage: pnpm version:set <version>

Syncs:
  package.json
  src-tauri/tauri.conf.json
  src-tauri/Cargo.toml
  src-tauri/Cargo.lock   (package catrace only)

Example:
  pnpm version:set 26.8.26`)
  process.exit(code)
}

function fail(msg) {
  console.error(`[version:set] ${msg}`)
  process.exit(1)
}

function replaceUnique(buf, search, replace, file) {
  const s = Buffer.from(search)
  const r = Buffer.from(replace)
  const idx = buf.indexOf(s)
  if (idx === -1) return { buf, found: false, changed: false }
  if (buf.indexOf(s, idx + 1) !== -1) fail(`pattern not unique in ${file}`)
  if (s.equals(r)) return { buf, found: true, changed: false }
  const out = Buffer.allocUnsafe(buf.length - s.length + r.length)
  buf.copy(out, 0, 0, idx)
  r.copy(out, idx)
  buf.copy(out, idx + r.length, idx + s.length)
  return { buf: out, found: true, changed: true }
}

function replaceFirstMatch(buf, variants, file) {
  for (const [search, replace] of variants) {
    const res = replaceUnique(buf, search, replace, file)
    if (res.found) return res
  }
  fail(`version pattern not found in ${file}`)
}

const next = (process.argv[2] ?? '').trim()
if (!next || next === '-h' || next === '--help') usage(next ? 0 : 1)
if (!VERSION_RE.test(next)) fail(`invalid version "${next}" (expected x.y.z)`)

const targets = [
  {
    rel: 'package.json',
    currentRe: /"name"\s*:\s*"catrace"[\s\S]*?"version"\s*:\s*"([^"]+)"/,
    variants: (cur) => [
      [`"version": "${cur}"`, `"version": "${next}"`],
      [`"version":"${cur}"`, `"version":"${next}"`],
    ],
  },
  {
    rel: 'src-tauri/tauri.conf.json',
    currentRe: /"productName"\s*:\s*"catrace"[\s\S]*?"version"\s*:\s*"([^"]+)"/,
    variants: (cur) => [
      [`"version": "${cur}"`, `"version": "${next}"`],
      [`"version":"${cur}"`, `"version":"${next}"`],
    ],
  },
  {
    rel: 'src-tauri/Cargo.toml',
    currentRe: /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
    variants: (cur) => [
      [`version = "${cur}"`, `version = "${next}"`],
    ],
  },
  {
    rel: 'src-tauri/Cargo.lock',
    currentRe: /name\s*=\s*"catrace"\s+version\s*=\s*"([^"]+)"/,
    variants: (cur) => [
      [`name = "catrace"\nversion = "${cur}"`, `name = "catrace"\nversion = "${next}"`],
      [`name = "catrace"\r\nversion = "${cur}"`, `name = "catrace"\r\nversion = "${next}"`],
    ],
  },
]

let changed = 0
for (const t of targets) {
  const file = resolve(root, t.rel)
  let buf
  try {
    buf = readFileSync(file)
  } catch (err) {
    fail(`cannot read ${t.rel}: ${err.message}`)
  }
  const m = buf.toString('utf8').match(t.currentRe)
  if (!m) fail(`cannot read current version from ${t.rel}`)
  const cur = m[1]
  const res = replaceFirstMatch(buf, t.variants(cur), t.rel)
  if (res.changed) {
    writeFileSync(file, res.buf)
    changed++
    console.log(`[version:set] ${t.rel}: ${cur} -> ${next}`)
  } else {
    console.log(`[version:set] ${t.rel}: ${cur} (unchanged)`)
  }
}

if (changed === 0) {
  console.log(`[version:set] already ${next}`)
} else {
  console.log(`[version:set] synced ${changed} file(s) to ${next}`)
}
