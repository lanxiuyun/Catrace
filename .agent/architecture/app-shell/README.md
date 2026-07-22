# 普通应用外壳

Catrace 普通页面统一使用顶部导航和覆盖式滚动容器；Reminder 系列窗口继续使用独立渲染路径。

## Component / module hierarchy

```text
App.vue
├── ReminderPopup / ReminderFullscreen / ReminderToast（特殊路由，绕过 app-shell）
└── app-shell（普通路由）
    ├── global-header（品牌、版本、一级导航）
    └── OverlayScrollbar
        └── RouterView + KeepAlive
            └── Plugins.vue
                ├── plugin-rail（标题、搜索、插件列表）+ OverlayScrollbar
                └── plugin-main
                    └── 插件 Panel（固定顶栏 + OverlayScrollbar 内容区）
```

## Data flow

- `App.vue` 根据路由区分 Reminder 窗口与普通页面。
- 普通路由在 `app-shell` 中渲染，一级导航使用 `RouterLink` 的 active 状态。
- `OverlayScrollbar` 隐藏原生滚动条，根据 viewport/content 尺寸计算覆盖式滑块；内容与容器变化通过 `ResizeObserver` 和 `MutationObserver` 触发更新。
- 插件页自身管理二级栏和详情区滚动，外层主滚动容器不会替代这两个局部滚动区域。

## Key conventions

- 普通页面样式限定在 `.app-shell` 内，禁止影响 Reminder Toast 的窗口尺寸测量。
- 同一滚动区域只保留一个滚动容器；接入 `OverlayScrollbar` 后，外层容器应使用 `overflow: hidden`。
- 覆盖式滑块默认隐藏，仅在 hover 或拖动时显示，不占内容布局宽度。
- 插件页面保持左右分栏；窄窗口只收窄左栏，不改为上下堆叠。
- Header 的间距是固定值，不根据窗口宽度动态修改：高度为 `3rem`，左 padding 为 `0.75rem`。
- 应用级辅助信息放在全局顶栏右侧；插件侧栏顶栏只保留插件上下文和刷新操作。
- 内置插件详情的标题与总开关固定，只有配置内容区滚动。

## Sub-docs

- [覆盖式滚动条不能影响-Toast-窗口尺寸测量.md](覆盖式滚动条不能影响-Toast-窗口尺寸测量.md) — 覆盖式滚动条与 Reminder 窗口的隔离边界。
- [插件页左侧插件中心与右侧固定顶栏的布局约定.md](插件页左侧插件中心与右侧固定顶栏的布局约定.md) — 插件页侧栏、搜索、状态与详情滚动结构。

## Change points

1. 修改一级导航或普通页面外壳：`src/App.vue`。
2. 修改覆盖式滚动行为：`src/components/OverlayScrollbar.vue`。
3. 修改插件二级栏或独立滚动区：`src/views/Plugins.vue`。
4. Reminder 路由相关改动必须确认仍绕过 `.app-shell`。
