# 外部插件设置页统一用 HeroUI 组件

宿主所有窗口的 UI 已经是 HeroUI v3（见[宿主界面迁到 HeroUI 3](../devlog/2026-11-11-宿主界面迁到HeroUI-3并把Radix限定到插件UI.md)），但外部插件的设置面板一直是 Radix Themes / 手写控件，同一个插件详情页里「久坐提醒」和外部插件设置怎么看都不像一家人。本轮把已上架的外部插件设置页统一改成 HeroUI。

## 宿主侧改动

插件是 Blob ESM，不能 `import` 包，只能拿宿主注入的全局。因此 [pluginRuntime.ts](../../../src/plugins/pluginRuntime.ts) 在原有 `__CATRACE_REACT__` / `__CATRACE_RADIX__` 之外新增注入 `__CATRACE_HEROUI__`（`@heroui/react` 命名空间）：

```ts
import * as HeroUI from '@heroui/react'
globalThis.__CATRACE_HEROUI__ ??= HeroUI
```

- HeroUI 已随宿主 bundle 打包，注入不额外拉一次依赖；样式的真源仍是宿主的 [heroui.css](../../../src/styles/heroui.css)，插件不需要、也不应该自带控件皮肤。
- `__CATRACE_RADIX__` 继续注入：尚未迁移的插件 Card 与旧设置页仍依赖它，根 Radix `Theme` 这个「插件 UI 边界」也还不能删。
- 合同测试 [test-react-plugin-packages.mjs](../../../scripts/test-react-plugin-packages.mjs) 同步注入 `__CATRACE_HEROUI__`，并新增「自包含插件模块可以渲染 HeroUI 组件」用例；`manifest.version` 从写死某个日期改成日期格式断言，避免每次发版都改测试。

## 迁移范围

| 状态 | 插件 |
|---|---|
| 设置页已改 HeroUI | agent-notify、dsh-chat、github-notify、pastedrop、smsforwarder-notify |
| 仍走 Radix / 手写控件 | timer、bt-music、heatmap、wecom-todo、linuxdo-notify、napcat-qq、pywechat-reply、sidecar-echo、notify-demo、dota2-typewriter |
| Toast 卡片（`ui.mjs`） | 本次不动，仍走 Radix 或自绘 |

新插件、以及后续迁移的插件设置页统一按 catrace-plugin 仓库的 `.agent/features/shared-ui/hero-ui-settings.md` 写。

## 约定摘要

- 只用扁平导出（`SwitchRoot` / `SwitchContent` / `SelectRoot` / `SelectTrigger` / `SliderRoot` …），不用 `Switch.Content` 这类复合静态属性——插件自己的 Node 单测把组件 stub 成字符串类型时无法构造静态属性；渲染结果一致。
- 输入 / 多行输入 / 下拉 `variant="secondary"`：`primary` 变体的底色在浅色主题下是白色且边框宽度为 0，放在白色设置卡上等于隐形。
- 按钮 `size="sm"`，主操作 `primary`、次操作 `secondary` / `tertiary`、危险 `danger-soft`；状态胶囊用 `Chip size="sm" variant="soft"`。
- 分段选择（原 Radix `SegmentedControl`）用 `ToggleButtonGroup` + `ToggleButton`，`onSelectionChange` 收到的是 `Set`。
- 数字输入用扁平组合 `NumberFieldRoot > NumberFieldGroup > (DecrementButton, Input, IncrementButton)`，`variant="secondary"`，`formatOptions={{ useGrouping: false }}`，宽度留够 9rem 放 −/+ 按钮。
- 分组用 `TabsRoot` 时不能省 `TabListContainer`：HeroUI 默认的灰色底轨画在它上面，漏了会变成一条铺满的白底 tab。
- 布局仍归插件：卡片、分组标题、行距由插件自己的 CSS 负责；不要用 Tailwind utility class（宿主 Tailwind 只扫描宿主源码），也不要把 `.card` / `.badge` / `.header` 这类 HeroUI 全局根类贴到原生 div 上。

## 验证

- 宿主：`$env:CATRACE_PLUGIN_SOURCE='<插件仓库路径>'; node --test scripts/test-react-plugin-packages.mjs`。测试用真实 React + 真实 HeroUI 对 15 个插件的 ui/settings 做 SSR 初始渲染，并检查 settings 初始渲染不触发 I/O。
- 插件仓库：各插件自己的 Node 单测（stub `__CATRACE_HEROUI__` 为字符串组件类型）继续覆盖配置读写、RPC、防抖与卸载 flush。
- 实际界面效果需要用户在应用里看：插件要重新安装才会用到新源码，宿主侧改动则随应用更新生效。

## 相关

- 外部插件合同：[m10-external-plugins.md](../architecture/desktop-event-os/m10-external-plugins.md)
- 宿主设置控件语言：[插件详情页设置面板的行语言与控件尺寸规范.md](插件详情页设置面板的行语言与控件尺寸规范.md)
- HeroUI 全局类名撞车约定：[HeroUI组件全局类名和Catrace通用类名撞车的处理约定.md](../architecture/theme/HeroUI组件全局类名和Catrace通用类名撞车的处理约定.md)
