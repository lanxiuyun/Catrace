/**
 * View Transitions API 的可用性判断：只做 `typeof document.startViewTransition` 检测不够。
 *
 * Linux 的 Tauri WebView 是 WebKitGTK，它从 2.52 起暴露了 startViewTransition，
 * 但真正调用时会在 WebKit 内部空指针崩溃（SIGSEGV，`mov rcx, [rdi+0x48]` 且 rdi=0），
 * 整个应用进程直接退出——Rust panic 捕获不到，界面日志也停在崩溃前一行。
 * 因此 Linux 上的 WebKitGTK 必须按内核排除，退化为瞬切。
 * 复现与调用栈见 .agent/bugs/2026-11-15-linux-webkitgtk-view-transition-段错误.md
 */
type StartViewTransition = (callback: () => void) => { finished: Promise<void> }

/** 已确认可安全调用 startViewTransition 的 document。 */
export type ViewTransitionDocument = Document & { startViewTransition: StartViewTransition }

type MaybeViewTransitionDocument = Document & { startViewTransition?: StartViewTransition }

/**
 * WebKitGTK 的 UA：`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 ... Safari/605.1.15`。
 * Windows 的 WebView2 带 `Chrome/`，macOS 的 WKWebView 不带 `Linux`，都不会命中。
 */
function isWebKitGtk(): boolean {
  const ua = navigator.userAgent
  return /Linux/.test(ua) && /AppleWebKit/.test(ua) && !/Chrome|Chromium/.test(ua)
}

/** 当前 WebView 能安全使用 View Transitions 时返回 document，否则返回 null。 */
export function viewTransitionDocument(): ViewTransitionDocument | null {
  if (typeof document === 'undefined') return null
  if (isWebKitGtk()) return null
  const doc = document as MaybeViewTransitionDocument
  return typeof doc.startViewTransition === 'function' ? (doc as ViewTransitionDocument) : null
}

/** 给只需要布尔开关的调用方（如 react-router 的 viewTransition 属性）。 */
export function canUseViewTransition(): boolean {
  return viewTransitionDocument() !== null
}
