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
width: 100%;
max-width: 64rem;
margin: 0 auto;
padding: 1.5rem 2rem 2rem;
```

内置与无 settings 的外部占位共用同一路径；有 `SettingsComponent` 的外部插件同样包在这层里。

## 面板作者约定

| 该做 | 不该做 |
|------|--------|
| 业务控件、规则列表、`PluginSection` | 再包一层 layout shell |
| 依赖宿主 padding | 自己写 `max-width: 64rem` / 大块外 padding |
| 暴露 `headerEnabled` / `toggleEnabled` 给顶栏 | 在面板内再画总开关顶栏 |

外部示例：`tools/plugin-demo/timer/settings.mjs` 根节点只保留业务样式，注释标明边距归宿主。

## 历史

曾抽 `PluginPanelShell.vue` 给 Rest/Agent 共用外壳，与宿主占位、外部 settings 三处重复。已删除；见旧笔记 [unify-plugin-panel-shell-and-section-for-agent-rest-panels.md](unify-plugin-panel-shell-and-section-for-agent-rest-panels.md)（仅作历史）。

相关：[[app-shell]] 高度铺满与双层滚动约定。
