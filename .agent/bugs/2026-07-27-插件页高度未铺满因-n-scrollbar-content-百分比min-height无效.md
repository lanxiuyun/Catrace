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

## 最终修复：主壳不滚，页面自己拥有滚动

只收紧 scoped `:deep` 选择器不够。它能让内层 `plugin-scroll` 形成 overflow，但只要 `MainShell` 仍包 workspace scrollbar，`/plugins` 最右侧就可能出现跨过插件详情顶栏的整页滚动条。

最终采用更直接的页面布局约定：

- `MainShell` 只提供固定全局顶栏、全高工作区、`RouterView + KeepAlive`，永远不创建 scrollbar。
- Dashboard / Settings / Debug 各自包公共 `PageScroll`。
- `Plugins.vue` 不包 `PageScroll`；唯一纵向滚动区域是右侧 `plugin-scroll`，`PluginNavRail` 与 `PluginPanelHeader` 都在它外面。

普通页面滚动壳与插件详情都只约束自己的直接 scrollbar container，不能用 `.app-workspace :deep(.n-scrollbar-content)` 这类跨页面规则。

插件详情滚动边界：

```css
.plugin-scroll > :deep(.n-scrollbar-container) {
  height: 100%;
}

.plugin-scroll > :deep(.n-scrollbar-container > .n-scrollbar-content) {
  min-height: 100%;
}
```

container 固定为可视区，content 不设固定高度，允许随业务内容增长。需要常显滑块时才使用 `trigger="none"`；hover 不显示时先检查是否真实形成 overflow。

不能写 `.app-workspace :deep(.n-scrollbar-content)` 这类宽泛规则；否则会锁死嵌套 scrollbar 或外部插件自带 scrollbar 的 content。

## 涉及文件

- `src/views/mainWindow/MainShell.vue`
- `src/components/PageScroll.vue`
- `src/views/mainWindow/Dashboard.vue`
- `src/views/mainWindow/Settings.vue`
- `src/views/mainWindow/Debug.vue`
- `src/views/mainWindow/Plugins.vue`
