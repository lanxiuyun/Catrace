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

- `src/styles/theme.css`：`--ct-*` token 亮/暗两套，改配色只改这里
- `src/app/radix-theme.css`：把 Radix Themes 的颜色变量（`--gray-*` / `--accent-*`）接到 `--ct-*` 上，Radix 组件自动跟随主题
- **Radix 强调色要整组映射**：Radix 的 accent 是 iris（偏紫），只改 `--accent-9/10/11` 三档实心色是不够的——聚焦环（`--focus-8` → `accent-8`）、soft 底（`accent-a3/a4/a5`）、透明描边（`a7/a8`）、开关/滑块轨道（`--accent-track`）取的还是 iris，于是设置页输入框聚焦会出现紫圈。现在 `radix-theme.css` 把 iris 色阶整组接到系统蓝：1–7 / 12 与 `a1–a12` 借 Radix blue 色阶（明暗主题自动跟随），**8（聚焦环 / 强描边）和 9/10/11（实心填充）用 `--ct-accent*` token**。8 档别再改回 `blue-8` 的浅天蓝，会和页面里自定义的 `:focus-visible` 对不上
- 字体跟随系统（macOS = SF Pro、Windows = Segoe UI），等宽用 `ui-monospace`
- Toast / 提醒窗里的 Radix 按钮由各自卡片的 CSS 补紧凑皮肤（高度、字号、胶囊色按卡片语义定），全局 `radix-theme.css` 只负责 token 映射、hover、焦点环与光标，不写单卡尺寸
- [useTheme.ts](../../../src/composables/useTheme.ts) 的 `initTheme` / `setThemeMode` 管理 Store 键 `theme.mode`、系统 matchMedia 与跨窗 `catrace-theme-changed`；React `useTheme()` 返回普通 mode/resolved 值，真源在 zustand shell store。
- 每个 WebView 的根 Radix Theme 订阅 resolvedTheme；插件使用相同 CSS token，样式文本可经 `plugin.theme.css(cssText)` 转换后赋给 style 节点。

## 设计约定

- **克制**：颜色只给状态语义（蓝 = 活跃、绿 = 休息）；数字本身用正文色，强调色只出现在图标、选中项、占比条这类"有含义"的地方
- **分层**：卡片靠「轻描边 + 双层阴影」和背景分离，不靠重描边；越大的表面阴影越深
- **材质**：侧边栏透光 + 细分隔线；窗口背景带一层极淡柔光，避免整页平灰
- **尺寸**：1rem = 16px，间距/字号一律 rem；只有 1px 边框、blur、SVG viewBox 用 px
- **动效**：默认 `cubic-bezier(0.2, 0, 0, 1)`；展开/收起用 `grid-template-rows` 过渡；`prefers-reduced-motion` 下关掉位移与循环动画（见 `timeline-windows.css`）
