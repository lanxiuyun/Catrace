# 设置页按 plugin registry 挂载插件设置卡

## 目标

M7c：内置插件注册后，设置页不再写死 agent/water/eye 导入列表，改为读 registry。
产品插件（久坐、Agent 等）挂在**功能插件**页；系统设置页只挂 `settingsSurface === 'settings'` 的卡。

## 约定

| settingsSurface | 挂载位置 |
|-----------------|----------|
| `settings` | 系统设置网格（可拖拽排序） |
| `plugins` | 功能插件页详情 |
| `none` | 仅 bus/事件注册，无 UI |

## 实现

- `PluginHandle.settingsSurface` + `getSettingsPlugins(surface)`
- `registerBuiltins`：rest/agent=`plugins`，water/eye=`none`（当前无 `settings` 面插件）
- `Settings.vue`：core 卡 + registry `settings` 卡合并默认顺序，排序键仍 `settings_group_order`
- `Plugins.vue`：可见 allowlist `['rest','agent']`；详情组件优先 registry `SettingsComponent`

## 手测

1. 功能插件列表出现久坐 + Agent；点 Agent 进入详情（开关/Hook/事件模式/提示音）
2. 系统设置**无** Agent 卡；无喝水/护眼卡
3. 系统设置拖拽排序仅核心卡，重启后顺序保留
