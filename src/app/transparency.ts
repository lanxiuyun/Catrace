/**
 * 产品决定：界面透明度只认 Catrace 自己的设置，系统的「减少透明度」不参与。
 *
 * liquid-glass-react 会读 `prefers-reduced-transparency: reduce` 并整块退成
 * 不透明，而且没有“强制正常”的 API（`transparency` 只能往更不透明走）。
 * 所以这里只把这**一个**媒体查询钉成 no-preference，其它查询原样透传；
 * 应用关闭透明度时，改用 LGR 的 `transparency="opaque"` 显式退化。
 *
 * 必须在使用任何玻璃 provider 之前调用（入口处执行一次即可）。
 * 副作用范围：整个 webview 里读这条查询的代码都会看到 no-preference。
 */
const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)'

function noPreferenceQuery(): MediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  return {
    matches: false,
    media: REDUCED_TRANSPARENCY_QUERY,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.add(listener as (event: MediaQueryListEvent) => void)
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.delete(listener as (event: MediaQueryListEvent) => void)
    },
    addListener: (listener: ((event: MediaQueryListEvent) => void) | null) => {
      if (listener) listeners.add(listener)
    },
    removeListener: (listener: ((event: MediaQueryListEvent) => void) | null) => {
      if (listener) listeners.delete(listener)
    },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList
}

let installed = false
let nativeMatchMedia: ((query: string) => MediaQueryList) | null = null

export function installTransparencyPolicy(): void {
  if (installed) return
  installed = true
  nativeMatchMedia = window.matchMedia.bind(window)
  window.matchMedia = (query: string) =>
    query === REDUCED_TRANSPARENCY_QUERY ? noPreferenceQuery() : nativeMatchMedia!(query)
}

/**
 * 系统「减少透明度」的原始值。应用已经覆盖它，这个只用于诊断展示，
 * 让「系统说 reduce、界面却是玻璃」这件事有据可查。
 */
export function readSystemReducedTransparency(): boolean {
  const read = nativeMatchMedia ?? window.matchMedia.bind(window)
  try {
    return read(REDUCED_TRANSPARENCY_QUERY).matches
  } catch {
    return false
  }
}
