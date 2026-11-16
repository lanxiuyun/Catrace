# UI 主题

## 色板

唯一真源是 `src/styles/theme.css` 的 `--ct-*` token（亮/暗两套）。下表是与色板对应的常用值：

| 用途 | 亮色 | 暗色 |
|------|------|------|
| 页面背景 | `#F5F5F7` + 顶部极淡系统蓝柔光 | `#131316` + 同款柔光 |
| 卡片 / 面板 | `#FFFFFF` | `#1F1F23` |
| 次级表面（胶囊、轨道） | `#F0F0F5` | `#2A2A30` |
| 边框 | `rgba(0,0,0,.07)` | `rgba(255,255,255,.08)` |
| 卡片描边 | `rgba(0,0,0,.06)` | `rgba(255,255,255,.07)` |
| 主色（活跃） | `#007AFF` | `#0A84FF` |
| 辅色（休息） | `#34C759` / 文本绿 `#1E7A35` | `#30D158` |
| 正文 / 次要 / 三级文字 | `#1C1C1E` / `#6E6E73` / `#8E8E93` | `#F2F2F7` / `#AEAEB2` / `#8E8E93` |
| 侧边栏材质 | `rgba(237,237,243,.78)` | `rgba(30,30,36,.7)` |
| 导航选中 | `#FFFFFF`（白色胶囊） | `rgba(255,255,255,.12)` |
| 卡片阴影 | 贴边 + 远处散开的双层阴影 | 同结构，暗色加深 |

## 实现

- 宿主 UI 已切到 **HeroUI v3 + Tailwind 4**：`src/styles/heroui.css` 引入 `@heroui/styles`，Vite 用 `@tailwindcss/vite` 处理；`main.tsx` 在 Radix 样式之后加载它
- HeroUI 的主色暂用其默认 accent（蓝），没有强行映射到 `--ct-accent`；Catrace 自有样式（时间线、卡片、Toast 外壳）仍只读 `--ct-*`
- 主题模式由 `useTheme` 写到 `html[data-theme='dark']`，HeroUI 原生识别；[theme.css](../../../src/styles/theme.css) 的 `--ct-*` 仍是 Catrace 自有样式（卡片、时间线、Toast 卡）的颜色真源
- 白色卡片上的输入框 / 下拉统一用 HeroUI 内置的 `variant="secondary"`（浅灰底），不要再覆写 `--field-*` token；二级按钮、链接 tile 也用 `secondary` / `tertiary`
- 外部插件 UI：设置页已统一改用注入的 **HeroUI**（[外部插件设置页统一用HeroUI组件](../../features/plugin-center/外部插件设置页统一用HeroUI组件.md)），尚未迁移的 Card / 旧设置页仍用注入的 **Radix** 运行时；`radix-theme.css` 继续把 Radix 色阶（`--gray-*` / `--accent-*`）接到 `--ct-*`，让插件颜色、焦点环、开关轨道跟随应用主题
- Radix 强调色仍要**整组映射**：不能只改 `--accent-9/10/11`，聚焦环（`--focus-8`）、soft 底（`accent-a3/a4/a5`）和 `--accent-track` 也要一起接系统蓝，否则插件 UI 的输入框聚焦会出现 iris 紫圈
- 宿主页面已经没有 Radix 控件；`main.tsx` 的根 `<Theme>` 暂时保留，作为插件 UI 的主题边界。移除它之前要先在插件挂载处补上独立的 Radix Theme
- 字体跟随系统（macOS = SF Pro、Windows = Segoe UI），等宽用 `ui-monospace`
- Toast / 提醒窗的 HeroUI 控件由各自卡片 CSS 按语义补紧凑尺寸；全局 `heroui.css` 只负责引入和字段变体约定，不写单卡尺寸
- [useTheme.ts](../../../src/composables/useTheme.ts) 的 `initTheme` / `setThemeMode` 管理 Store 键 `theme.mode`、系统 matchMedia 与跨窗 `catrace-theme-changed`；React `useTheme()` 返回普通 mode/resolved 值，真源在 zustand shell store。
- 每个 WebView 的根 Theme 订阅 resolvedTheme；插件使用相同 CSS token，样式文本可经 `plugin.theme.css(cssText)` 转换后赋给 style 节点。

## 设计约定

- **克制**：颜色只给状态语义（蓝 = 活跃、绿 = 休息）；数字本身用正文色，强调色只出现在图标、选中项、占比条这类"有含义"的地方
- **分层**：卡片靠「轻描边 + 双层阴影」和背景分离，不靠重描边；越大的表面阴影越深
- **材质**：侧边栏透光 + 细分隔线；窗口背景带一层极淡柔光，避免整页平灰
- **尺寸**：1rem = 16px，间距/字号一律 rem；只有 1px 边框、blur、SVG viewBox 用 px
- **动效**：默认 `cubic-bezier(0.2, 0, 0, 1)`；展开/收起用 `grid-template-rows` 过渡；`prefers-reduced-motion` 下关掉位移与循环动画（见 `timeline-windows.css`）

## 子文档

- [HeroUI组件全局类名和Catrace通用类名撞车的处理约定.md](HeroUI组件全局类名和Catrace通用类名撞车的处理约定.md)：`.card` / `.badge` / `.header` / `.progress-bar` 等全局类撞车后的排查与修复规则。
