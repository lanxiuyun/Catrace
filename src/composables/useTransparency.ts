import { ref, type Ref } from 'vue'
import { load, type Store } from '@tauri-apps/plugin-store'
import { emit, listen } from '@tauri-apps/api/event'

/**
 * 界面透明度：应用内开关，是这条设置唯一的真源。
 *
 * 刻意不跟随系统的「透明效果」——用户可能在 Windows 里关掉它，但产品要求
 * 这里开关说了算（配套的媒体查询覆盖见 src/app/transparency.ts）。
 * 关闭时所有玻璃材质退成实心；侧栏等自绘半透明表面也由
 * `[data-ct-transparency='off']` 规则一起降级。
 */
export const TRANSPARENCY_CHANGED_EVENT = 'catrace-transparency-changed'

const STORE_FILE = 'settings.json'
const STORE_KEY = 'ui.transparency'
/** 默认开：产品默认观感就是玻璃。 */
const DEFAULT_ENABLED = true

const enabled = ref(DEFAULT_ENABLED)
let store: Store | null = null
let initialized = false

async function getStore(): Promise<Store> {
  if (!store) store = await load(STORE_FILE, { defaults: {}, autoSave: true })
  return store
}

function applyDom(): void {
  document.documentElement.dataset.ctTransparency = enabled.value ? 'on' : 'off'
}

async function setEnabled(value: boolean): Promise<void> {
  enabled.value = value
  applyDom()
  try {
    const s = await getStore()
    await s.set(STORE_KEY, value)
  } catch (e) {
    console.error('保存界面透明度失败', e)
  }
  // 广播给所有窗口（含自身，listener 里幂等）
  try {
    await emit(TRANSPARENCY_CHANGED_EVENT, { enabled: value })
  } catch (e) {
    console.error('广播界面透明度失败', e)
  }
}

/** 挂载前调用一次：读初值 + 落地 DOM 属性 + 装跨窗口监听。 */
async function init(): Promise<void> {
  if (initialized) return
  initialized = true

  try {
    const s = await getStore()
    const saved = await s.get<boolean>(STORE_KEY)
    if (typeof saved === 'boolean') enabled.value = saved
  } catch (e) {
    console.error('读取界面透明度失败，回退默认开', e)
  }

  applyDom()

  try {
    await listen<{ enabled: boolean }>(TRANSPARENCY_CHANGED_EVENT, (ev) => {
      const next = ev.payload?.enabled
      if (typeof next === 'boolean' && next !== enabled.value) {
        enabled.value = next
        applyDom()
      }
    })
  } catch (e) {
    console.error('监听界面透明度失败', e)
  }
}

export function useTransparency(): {
  enabled: Ref<boolean>
  setEnabled: (value: boolean) => Promise<void>
  init: () => Promise<void>
} {
  return { enabled, setEnabled, init }
}
