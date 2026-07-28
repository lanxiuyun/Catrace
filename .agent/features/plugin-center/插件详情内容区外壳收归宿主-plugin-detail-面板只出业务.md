# 插件详情内容区外壳收归宿主

## 结论

- **边距 / 最大宽度 / section 间距**只由 `Plugins.vue` 的 `.plugin-detail` 提供。
- **内置面板**（`RestPluginPanel` / `AgentPluginPanel`）与 **外部 `settings.mjs`** 只写业务 UI。
- **不要**再引入 `PluginPanelShell` 或在面板里重复 `max-width: 64rem` + `padding: 1.5rem 2rem`。
- **Section 卡片**仍可用 `PluginSection.vue`（标题 + 描述 + 白底卡片）。

## 挂载结构

```text
plugin-main
├── PluginPanelHeader          # 固定顶栏：图标/标题/总开关
└── n-scrollbar.plugin-scroll  # 详情区纵向滚动
    └── plugin-detail-wrapper  # relative，供禁用 overlay
        ├── plugin-detail-content  # 灰显目标
        │   └── .plugin-detail     # 唯一内容外壳
        │       └── ActiveDetail / 外部占位
        └── disabled-overlay
```

## 宿主 `.plugin-detail` 职责

```css
display: flex;
flex-direction: column;
gap: 1.25rem;
max-width: 64rem;
box-sizing: border-box;
margin: 0 auto;
padding: 1.5rem 2rem 2rem;
```

窄屏（`max-width: 56.25rem` / 900px）宿主改为 `padding: 1.25rem`。**响应式边距只改宿主这一处。**

内置、无 settings 的外部占位、有 `SettingsComponent` 的外部插件，共用同一路径。

## 面板作者约定

| 该做 | 不该做 |
|------|--------|
| 业务控件、规则列表、`PluginSection` | 再包一层 layout shell |
| 依赖宿主 padding | 自己写 `max-width: 64rem` / 根上大块外 padding |
| 卡片/列表**内部**间距 | 在 settings 根上再写与宿主同值的 `@media` padding（窄屏双倍缩进） |
| 暴露 `headerEnabled` / `toggleEnabled` 给顶栏（内置） | 在面板内再画总开关顶栏 |

外部示例：`tools/plugin-demo/timer/settings.mjs` 根节点只保留业务样式，注释标明边距归宿主。开发约定全文见 [[desktop-event-os]] [m10-external-plugins.md](../../architecture/desktop-event-os/m10-external-plugins.md)「settings.mjs 布局合同」。

### 反例（已修）

timer 曾在 `settings.mjs` 留下：

```css
@media (max-width: 56.25rem) {
  .timer-settings { padding: 1.25rem; }
}
```

宽屏几乎看不出，窄屏 = 宿主 `1.25rem` + 插件 `1.25rem`，外部插件比内置多一圈内缩。根因不是「外部走了另一条宿主路径」，而是插件 CSS 残留。

## 历史

曾抽 `PluginPanelShell.vue` 给 Rest/Agent 共用外壳，与宿主占位、外部 settings 三处重复。已删除；见旧笔记 [unify-plugin-panel-shell-and-section-for-agent-rest-panels.md](unify-plugin-panel-shell-and-section-for-agent-rest-panels.md)（仅作历史）。

相关：[[app-shell]] 高度铺满与双层滚动约定。
