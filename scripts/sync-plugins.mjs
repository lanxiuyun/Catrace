// Sync plugin sub-folders from tools/plugin-demo into src-tauri/.bundled-plugins
// before bundling, so only real plugin packages (dir + manifest.json) get
// embedded as Tauri resources — no .git, no loose docs, no screenshots.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '../tools/plugin-demo')
const outRoot = resolve(here, '../src-tauri/.bundled-plugins')

rmSync(outRoot, { recursive: true, force: true })
mkdirSync(outRoot, { recursive: true })

let count = 0
for (const name of readdirSync(srcRoot)) {
  const src = join(srcRoot, name)
  if (!statSync(src).isDirectory()) continue
  if (name.startsWith('.')) continue
  if (!existsSync(join(src, 'manifest.json'))) continue
  cpSync(src, join(outRoot, name), {
    recursive: true,
    filter: (p) => {
      const rel = p.slice(src.length).split(/[\\/]/)
      return !rel.includes('.git')
    },
  })
  count++
}

console.log(`[sync-plugins] staged ${count} plugin(s) -> ${outRoot}`)
