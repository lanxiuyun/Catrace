# 插件页高度未铺满：n-scrollbar-content 百分比高度

## 症状

功能插件页左右栏/主内容只撑到业务内容高度（约 500px+），工作区下方大块空白。DevTools 可见外层 `div.n-scrollbar-content` 高度 ≈ 内容高，不是工作区高。

## 根因

`MainShell` 结构：

```text
.app-workspace          /* flex:1; min-height:0 — 有明确高度 */
  n-scrollbar           /* height:100% */
    .n-scrollbar-container
      .n-scrollbar-content   /* 默认按内容 sizing，无 height */
        路由页（plugins-page height:100%）
```

- 百分比 `height` / `min-height` 需要包含块 **height 已确定**。
- `.n-scrollbar-content` 默认只 `min-width: 100%`，高度跟子内容走。
- 仅设 `min-height: 100%` 时，在该层常因参照 indefinite 而**算不成**，表现仍像内容高。
- 子页 `height: 100%` 跟着塌掉 → 侧栏背景不铺满。

## 修复

在 `MainShell.vue`：

```css
.app-workspace :deep(.n-scrollbar-container),
.app-workspace :deep(.n-scrollbar-content) {
  height: 100%;
}
```

用 **`height: 100%`** 把 container/content 钉在工作区明确高度上，短页（插件）才能铺满。

插件详情区自有 `n-scrollbar.plugin-scroll`（顶栏外、内容内滚）。滚动条默认 `trigger="hover"` 只悬停显示；需要常显时用 `trigger="none"`。

## 涉及文件

- `src/views/mainWindow/MainShell.vue`
- `src/views/mainWindow/Plugins.vue`
