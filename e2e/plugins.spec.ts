import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import { createServer } from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

function serveDist(preferredPort: number) {
  const server = createServer((req, res) => {
    const dist = join(__dirname, '..', 'dist')
    let file = join(dist, req.url === '/' ? 'index.html' : req.url!)
    try {
      const data = readFileSync(file)
      const ext = file.match(/\.[^.]+$/)?.[0] ?? ''
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(data)
    } catch {
      try {
        const data = readFileSync(join(dist, 'index.html'))
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(data)
      } catch (e) {
        res.writeHead(500)
        res.end(String(e))
      }
    }
  })
  return new Promise<number>((resolve, reject) => {
    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : preferredPort)
    })
    server.on('error', reject)
  })
}

test('plugins page visual regression with rules', async ({ page }) => {
  const port = await serveDist(8765)
  await page.goto(`http://127.0.0.1:${port}/#/plugins`)
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.waitForTimeout(1000)

  // add a few presets to see rule cards
  await page.click('.preset-chip:nth-child(1)')
  await page.waitForTimeout(200)
  await page.click('.preset-chip:nth-child(2)')
  await page.waitForTimeout(200)
  await page.click('.preset-chip:nth-child(4)')
  // wait for message toasts to fade out
  await page.waitForTimeout(3500)

  await page.screenshot({ path: 'playwright-report/plugins-page-with-rules.png', fullPage: true })
})
