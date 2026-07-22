# 覆盖式滚动条为什么不能作用到 Toast 窗口

## 背景

普通页面希望获得类似 Element Plus Scrollbar 的体验：原生滚动条不可见，鼠标进入滚动区域后显示浮层滑块，并且滑块不占内容宽度。

## 实现边界

`OverlayScrollbar.vue` 只包裹普通应用工作区及插件页的局部滚动区域。Reminder Toast 不使用该组件，也不挂载 `.app-shell`。

原因是 Toast 窗口会根据 DOM 实际尺寸计算 Tauri 窗口高度。全局修改 `box-sizing`、滚动条宽度或 overflow 规则可能改变测量结果，造成卡片裁切或显示不完整。

## 使用规则

```vue
<main class="content-shell">
  <OverlayScrollbar>
    <div class="content">...</div>
  </OverlayScrollbar>
</main>
```

外层应满足：

```css
.content-shell {
  min-height: 0;
  overflow: hidden;
}
```

不要同时在 `.content-shell` 或内部内容节点设置同方向的 `overflow-y: auto`，否则会形成嵌套滚动。

## 当前行为

- 原生滚动条通过 `scrollbar-width: none` 和 WebKit scrollbar 规则隐藏。
- 滑块绝对定位在右侧，不参与内容宽度计算。
- hover 或拖动时显示。
- 支持滚轮、触控板及拖动滑块。
- `ResizeObserver` 负责容器尺寸变化，`MutationObserver` 负责动态内容变化。
