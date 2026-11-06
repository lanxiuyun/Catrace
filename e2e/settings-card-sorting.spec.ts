import { test, expect } from '@playwright/test'

// Connect to an already running app; never start a dev server from this test.
test.use({
  baseURL: process.env.CATRACE_TEST_URL || 'http://localhost:1420',
  channel: process.env.PLAYWRIGHT_CHANNEL,
})

const initial = ['media', 'signal', 'system', 'sysNotify', 'links']
interface Scenario {
  name: string
  width: number
  from: number
  to: number
  depth: number
  returnTo?: number
  leaveGrid?: boolean
}
const cases: Scenario[] = [
  { name: '两列从 1 拖到 3 顶部', width: 1050, from: 0, to: 2, depth: 0.08 },
  { name: '两列从 1 拖到 3 中部', width: 1050, from: 0, to: 2, depth: 0.5 },
  { name: '两列从 1 拖到 4', width: 1050, from: 0, to: 3, depth: 0.5 },
  { name: '两列从 4 拖到 1', width: 1050, from: 3, to: 0, depth: 0.5 },
  { name: '两列从左拖到右', width: 1050, from: 0, to: 1, depth: 0.2 },
  { name: '两列从右拖到左', width: 1050, from: 1, to: 0, depth: 0.2 },
  { name: '单列向下拖', width: 720, from: 0, to: 2, depth: 0.5 },
  { name: '单列向上拖', width: 720, from: 2, to: 0, depth: 0.5 },
  { name: '三列跨行拖', width: 1510, from: 0, to: 4, depth: 0.5 },
  { name: '移出网格保留已换位顺序', width: 1050, from: 0, to: 3, depth: 0.5, leaveGrid: true },
  { name: '斜向拖动后主动反向', width: 1050, from: 0, to: 3, depth: 0.5, returnTo: 0 },
  { name: '斜向拖动后横向转弯', width: 1050, from: 0, to: 3, depth: 0.5, returnTo: 2 },
  { name: '同排拖动后主动反向', width: 1050, from: 0, to: 1, depth: 0.2, returnTo: 0 },
]

for (const scenario of cases) {
  test(`设置卡片实时拖动：${scenario.name}`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 2400 })
    await page.goto('/#/settings')
    const grid = page.locator('.ct-settings-grid')
    const cards = grid.locator(':scope > .ct-settings-slot')
    const getOrder = () => cards.evaluateAll(elements => elements.map(el => el.getAttribute('data-group-key')))
    await expect.poll(getOrder).toEqual(initial)
    await page.waitForTimeout(500)
    const originalCard = await cards.nth(scenario.from).elementHandle()
    await grid.evaluate(el => {
      el.setAttribute('data-swap-count', '0')
      el.addEventListener('change', () => {
        el.setAttribute('data-swap-count', String(Number(el.getAttribute('data-swap-count')) + 1))
      })
    })
    const handle = await page.locator(`[data-group-key="${initial[scenario.from]}"] .ct-drag-handle`).boundingBox()
    const target = await cards.nth(scenario.to).boundingBox()
    if (!handle || !target) throw new Error('Settings drag handle or target is not visible')
    const start = { x: handle.x + 12, y: handle.y + 12 }
    const end = { x: target.x + target.width * 0.7, y: target.y + target.height * scenario.depth }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x - 6, start.y)
    await page.waitForTimeout(100)
    let previousIndex = scenario.from
    for (let step = 1; step <= 25; step++) {
      await page.mouse.move(start.x + (end.x - start.x) * step / 25, start.y + (end.y - start.y) * step / 25)
      await page.waitForTimeout(20)
      const index = (await getOrder()).indexOf(initial[scenario.from])
      // A straight forward gesture must not be reversed by auto-sized rows.
      expect((index - previousIndex) * Math.sign(scenario.to - scenario.from)).toBeGreaterThanOrEqual(0)
      previousIndex = index
    }
    const expected = [...initial]
    const [moved] = expected.splice(scenario.from, 1)
    expected.splice(scenario.to, 0, moved)
    // Must swap before release: a drop-only preview would fail this assertion.
    expect(await getOrder()).toEqual(expected)
    const swapCount = await grid.getAttribute('data-swap-count')
    for (let hold = 0; hold < 6; hold++) {
      await page.waitForTimeout(200)
      expect(await getOrder()).toEqual(expected)
      await expect(grid).toHaveAttribute('data-swap-count', swapCount!)
    }
    // Small physical jitter must not undo the accepted swap either.
    for (const dx of [2, -2, 2, -2, 0]) {
      await page.mouse.move(end.x + dx, end.y)
      await page.waitForTimeout(80)
      expect(await getOrder()).toEqual(expected)
      await expect(grid).toHaveAttribute('data-swap-count', swapCount!)
    }
    if (scenario.returnTo !== undefined) {
      const destination = await cards.nth(scenario.returnTo).boundingBox()
      if (!destination) throw new Error('Return target is not visible')
      const back = { x: destination.x + destination.width * 0.7, y: destination.y + destination.height * 0.3 }
      for (let step = 1; step <= 40; step++) {
        await page.mouse.move(end.x + (back.x - end.x) * step / 40, end.y + (back.y - end.y) * step / 40)
        await page.waitForTimeout(25)
      }
      expected.splice(scenario.to, 1)
      expected.splice(scenario.returnTo, 0, moved)
      expect(await getOrder()).toEqual(expected)
      await page.waitForTimeout(500)
      expect(await getOrder()).toEqual(expected)
    }
    if (scenario.leaveGrid) await page.mouse.move(10, 10)
    await page.mouse.up()
    await expect.poll(getOrder).toEqual(expected)
    await expect(page.locator('.sortable-fallback')).toHaveCount(0)
    expect(await originalCard?.evaluate(el => el === document.querySelector(`[data-group-key="${el.getAttribute('data-group-key')}"]`))).toBe(true)
  })
}

test('设置卡片：同一页面连续两次排序，保留卡片实例', async ({ page }) => {
  await page.setViewportSize({ width: 1050, height: 2400 })
  await page.goto('/#/settings')
  const cards = page.locator('.ct-settings-grid > .ct-settings-slot')
  const getOrder = () => cards.evaluateAll(elements => elements.map(el => el.getAttribute('data-group-key')))
  await expect.poll(getOrder).toEqual(initial)
  await page.waitForTimeout(500)
  const originalMedia = await cards.first().elementHandle()
  for (const targetIndex of [3, 0]) {
    const handle = await page.locator('[data-group-key="media"] .ct-drag-handle').boundingBox()
    const target = await cards.nth(targetIndex).boundingBox()
    if (!handle || !target) throw new Error('Drag target is not visible')
    const start = { x: handle.x + 12, y: handle.y + 12 }
    const end = { x: target.x + target.width * 0.7, y: target.y + target.height * 0.3 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x - 6, start.y)
    await page.waitForTimeout(100)
    for (let step = 1; step <= 40; step++) {
      await page.mouse.move(start.x + (end.x - start.x) * step / 40, start.y + (end.y - start.y) * step / 40)
      await page.waitForTimeout(25)
    }
    const expected = initial.filter(key => key !== 'media')
    expected.splice(targetIndex, 0, 'media')
    expect(await getOrder()).toEqual(expected)
    await page.mouse.up()
    await expect.poll(getOrder).toEqual(expected)
    await expect(page.locator('.sortable-fallback')).toHaveCount(0)
    await page.waitForTimeout(250)
  }
  expect(await originalMedia?.evaluate(el => el === document.querySelector('[data-group-key="media"]'))).toBe(true)
})

test('设置卡片：拖动中离页清除浮动副本，再进入可以正常拖动', async ({ page }) => {
  await page.setViewportSize({ width: 1050, height: 1200 })
  await page.goto('/#/settings')
  const startDrag = async () => {
    await page.locator('.ct-drag-handle').first().waitFor()
    await page.waitForTimeout(500)
    const handle = await page.locator('.ct-drag-handle').first().boundingBox()
    if (!handle) throw new Error('Drag handle is not visible')
    await page.mouse.move(handle.x + 12, handle.y + 12)
    await page.mouse.down()
    await page.mouse.move(handle.x + 6, handle.y + 12)
    await expect(page.locator('.sortable-fallback')).toHaveCount(1)
  }
  await startDrag()
  await page.evaluate(() => { location.hash = '/' })
  await expect(page.locator('.ct-settings-grid')).toHaveCount(0)
  await expect(page.locator('.sortable-fallback')).toHaveCount(0)
  await page.mouse.up()
  await page.evaluate(() => { location.hash = '/settings' })
  await startDrag()
  await page.mouse.up()
  await expect(page.locator('.sortable-fallback')).toHaveCount(0)
})

test('设置卡片：点击手柄但不拖动，不改变顺序', async ({ page }) => {
  await page.goto('/#/settings')
  const cards = page.locator('.ct-settings-grid > .ct-settings-slot')
  const getOrder = () => cards.evaluateAll(elements => elements.map(el => el.getAttribute('data-group-key')))
  await expect.poll(getOrder).toEqual(initial)
  await page.waitForTimeout(500)
  await page.locator('.ct-drag-handle').first().click()
  expect(await getOrder()).toEqual(initial)
  await expect(page.locator('.sortable-fallback')).toHaveCount(0)
})
