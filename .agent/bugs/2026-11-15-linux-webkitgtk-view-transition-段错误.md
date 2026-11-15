# Linux 点击主窗导航整个应用段错误（WebKitGTK View Transitions）

**日期**：2026-11-15
**状态**：已修
**Issue**：[#107](https://github.com/lanxiuyun/Catrace/issues/107)

## 症状

Ubuntu 24.04 + X11 上，应用启动正常、插件加载正常，但点击主窗侧栏任一导航项后进程立刻退出。终端只打印 `段错误 (核心已转储)`，应用日志停在 `[timer] timer background loaded` 一类启动行，没有 panic、没有前端报错。开发模式与正式版表现一致；`WEBKIT_DISABLE_DMABUF_RENDERER=1`、`WEBKIT_DISABLE_COMPOSITING_MODE=1` 均无效。

## 根因

Linux 的 Tauri WebView 是 WebKitGTK。**2.52 起它实现了 `document.startViewTransition`，但真正调用时会在 WebKit 内部空指针崩溃**：

```
Thread 1 "catrace" received signal SIGSEGV
rip → mov rcx, QWORD PTR [rdi+0x48]     ; rdi = 0x0

#0..#8   libwebkit2gtk-4.1.so.0
#10..#12 libjavascriptcoregtk-4.1.so.0
#13..#15 libglib-2.0.so.0 → g_main_context_iteration
#16      gtk_main_iteration_do
#18      tao event_loop → catrace_lib::run
```

整条链是 GTK 主循环 → WebKit 内部 → JavaScriptCore（JS 执行路径），宿主 Rust 只出现在事件循环入口，因此这不是应用侧的非主线程 UI 操作，也不是渲染驱动问题。

隔离实验（本机实测）：

| 操作 | 结果 |
|---|---|
| 点击侧栏空白区域 | 不崩 |
| 点击导航项 | 崩（可稳定复现） |
| 移除 NavLink 的 `viewTransition` | 连点 Plugins / Settings / Debug 全部存活 |
| 恢复 `viewTransition` | 再次崩 |
| `LIBGL_ALWAYS_SOFTWARE=1` 软件渲染 | 仍崩 |

软件渲染同样崩，排除了 NVIDIA 专有驱动与 DMABUF/EGL 合成路径；`backdrop-filter` 在去掉 `viewTransition` 后仍生效且不崩，也排除了毛玻璃材质。

## 修复

问题不只在导航：`PluginCenter` 的“列表 ↔ 详情”切换同样会调用 `startViewTransition`。两处共用新的判断：

`src/app/lib/viewTransition.ts`

- `viewTransitionDocument()`：API 存在 **且不是 Linux WebKitGTK** 时返回 document，否则 `null`
- `canUseViewTransition()`：给 react-router 的布尔属性用
- WebKitGTK 通过 UA 识别（含 `Linux` + `AppleWebKit`、不含 `Chrome`）；WebView2 带 `Chrome/`，WKWebView 不带 `Linux`，都不会误伤

`src/app/shell/MainShell.tsx`：`<NavLink viewTransition={canUseViewTransition()}>`
`src/app/pages/plugins/PluginCenter.tsx`：`runPageTransition` 取不到 doc 时直接 `apply()`，走原有瞬切降级分支

只在 Linux 降级；Windows / macOS 仍保留交叉淡入淡出。

## 验证

- `pnpm vue-tsc --noEmit`、`pnpm build` 通过
- dev 模式下连续点击 Dashboard / Plugins / Settings / Debug 以及插件卡片，进程全部存活，切页为瞬切

## 注意

WebKitGTK 的支持检测不能只看 `typeof document.startViewTransition === 'function'`：API 存在但会崩。若后续 WebKitGTK 修复了该缺陷，需要先确认版本再放开 `isWebKitGtk` 的排除。
