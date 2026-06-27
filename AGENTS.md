> 本文档面向 AI 编程助手。详细核心逻辑、开发历史、测试清单分别见 [`docs/core-logic.md`](./docs/core-logic.md)、[`docs/development-log.md`](./docs/development-log.md)、[`docs/testing.md`](./docs/testing.md)。

---

## 项目概述

Catrace 是一款桌面端工具，帮助用户平衡工作与休息。

- **核心功能**：后台静默监听键鼠活动，判断用户是否处于连续工作状态；当连续活跃时间超过阈值时，通过系统通知提醒用户休息。
- **隐私承诺**：不偷拍屏幕、不上传数据，所有信息保存在用户本地。
- **当前状态**：核心功能已完成，前端 Dashboard 可查看今日活动与统计，Rust 后端已完成采样、判定、通知、数据库全流程。

---

## 已落地的技术栈

| 层级 | 选型 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3 + TypeScript + Vite + naive-ui |
| 图表 | 未使用 ECharts，时间轴用 CSS Grid 实现 |
| 后端（Rust）| rdev、device_query、rusqlite、tokio、active-win-pos-rs、windows（WASAPI，Windows 专属）、reqwest、uuid、md5、semver、tauri-plugin-autostart / opener / window-state / single-instance / updater |

---

## 目录结构

```
.
├── package.json          # pnpm + Vite + Vue 3
├── vite.config.ts
├── tsconfig.json
├── src/                  # Vue 3 前端
│   ├── api/tauri.ts
│   ├── components/       # settings/、Timeline、TimelineWindows、WaterWidget
│   ├── composables/
│   ├── i18n/
│   ├── router/
│   ├── utils/timeBlocks.ts
│   ├── views/            # Dashboard、Settings、Debug、ReminderToast/Popup/Fullscreen
│   ├── App.vue
│   ├── main.ts
│   └── theme.ts
├── src-tauri/            # Tauri 2 + Rust
│   └── src/
│       ├── main.rs             # 入口
│       ├── lib.rs              # 业务主逻辑：采样、结算、通知、命令、托盘、更新
│       ├── reminder.rs         # 提醒状态机
│       ├── reminder_toast.rs   # Toast 窗口计算
│       ├── window_manager/     # 无焦点提醒窗口（Windows WS_EX_NOACTIVATE）
│       ├── media_audio.rs      # Windows WASAPI 音频检测
│       ├── db.rs               # SQLite 读写 + block/喝水记录
│       ├── water.rs            # 喝水提醒状态机
│       └── report.rs           # 启动事件上报
├── docs/
│   ├── core-logic.md           # 核心逻辑详细说明
│   ├── development-log.md      # 开发进度历史
│   ├── testing.md              # 测试清单
│   └── version-management.md   # 版本号管理
└── public/
```

> Rust 侧当前将所有业务逻辑集中在 `lib.rs`，通过模块级函数组织；后续扩展时可再拆分。

---

## 配置项

| 配置名 | 说明 | 默认值 |
|--------|------|--------|
| `window_minutes` | 工作窗口长度（分钟） | 45 |
| `break_minutes` | 连续休息多少分钟算断开（分钟） | 5 |
| `snooze_interval_minutes` | 活跃满后重复提醒间隔（分钟） | 3 |
| `water_reminder_enabled` | 开启喝水提醒 | true |
| `water_interval_minutes` | 喝水间隔（多久未喝水则提醒，分钟） | 60 |
| `silent_start` | 开机自启时不显示主窗口 | false |
| `video_active_enabled` | 视频/音乐计入活跃总开关 | true |
| `media_whitelist` | Windows 音频输出进程排除列表（JSON 数组） | 默认系统进程列表 |
| `locale` | 界面语言（zh-CN / en-US） | 自动检测，回退 zh-CN |
| `reminder_mode` | 提醒模式（toast / popup / fullscreen） | toast |
| `fullscreen_bg_image` | 全屏背景图（data URL 或文件路径） | bundled catrace.png |
| `fullscreen_opacity` | 全屏遮罩透明度（0-100） | 80 |
| `fullscreen_fit_mode` | 背景填充模式（contain / cover / fill） | contain |
| `fullscreen_element_transforms` | 全屏元素变换 JSON | 默认居中 |

---

## 构建与运行命令

```bash
# 前端开发（不启动 Tauri）
pnpm dev

# Tauri 开发模式
pnpm tauri dev

# 构建发布版
pnpm tauri build

# Rust 侧类型检查 / 测试
cd src-tauri && cargo check
cd src-tauri && cargo test
```

---

## 版本号管理

**🔴 强约束**：每次修改版本号前，**必须先读取** [`docs/version-management.md`](./docs/version-management.md)，严格按文档要求同步更新所有文件。

---

## 代码风格与约定

- 项目文档与计划全部使用**中文**撰写，代码注释保持一致。
- 前端使用 **Vue 3 Composition API + `<script setup>` + TypeScript**。
- UI 配色统一维护在 `src/theme.ts`，改主题时优先改此文件。
- **前端长度单位统一使用 rem**：`src/` 下所有 Vue/CSS/SCSS 样式中的长度尺寸统一使用 `rem`（`1rem = 16px`），不再写 `px`。例外：物理 1px 边框、`backdrop-filter: blur(...)`、SVG 的 `width/height/viewBox` 可保留 px。
- **简单存储优先使用 Tauri Store 插件**：轻量级、前端相关的键值配置优先使用 `@tauri-apps/plugin-store`，存放到 `app_data_dir` 下的 JSON 文件中；仅当数据需要被 Rust 后端频繁读取、涉及业务核心状态或需要复杂查询时，才写入 SQLite。
- **🔴 强约束 — 跨平台**：Rust 后端开发任何功能（依赖、系统调用、原生 API、通知、托盘、键鼠监听等）必须首先评估跨平台兼容性。Catrace 目标平台为 **Windows / macOS / Linux**，禁止引入仅限单一平台的代码而不提供条件编译或降级方案。涉及平台专属 API 时必须用 `#[cfg(target_os = ...)]` 隔离，并在 `Cargo.toml` 中按 `target.'cfg(...)'.dependencies` 声明。

---

## 测试策略

- **Rust**：共 31 个单元测试，分布在 `db.rs`（16 个）、`reminder.rs`（4 个）、`report.rs`（4 个）、`water.rs`（3 个）、`media_audio.rs`（4 个）。详见 [`docs/testing.md`](./docs/testing.md)。
- **前端**：目前无自动化测试，依赖手动验证（`pnpm tauri dev` 观察界面）。

---

## 安全与隐私

- 全局键鼠监听仅计数，不记录按键内容或鼠标轨迹坐标。
- 数据库文件保存在 `app_data_dir/catrace.db`，不上传。
- 应用启动时会向 UpgradeLink 上报 `app_start` 事件（版本号、目标平台、架构、匿名设备标识），用于统计分析；不上传任何活动记录或隐私内容。
- `rdev`（Windows/Linux）与 `device_query`（macOS 键盘/鼠标）、`active-win-pos-rs` 需要系统权限（macOS Accessibility / Windows UI Access）。

---

## 对 AI 助手的提示

1. **代码已存在**：项目已完整初始化，无需再执行框架初始化命令。
2. **优先读代码再改**：Rust 逻辑集中在 `src-tauri/src/lib.rs`，前端逻辑在 `src/views/`、`src/components/`、`src/theme.ts`。
3. **保持中文文档**：README、AGENTS 等文档均为中文，新增文档继续使用中文。
4. **Timeline 实现方式**：详细视图使用 CSS Grid（24×60 的 `<div>` 网格），不是 SVG / Canvas / ECharts；概览视图使用前瞻式 block 切分卡片网格。详见 [`docs/core-logic.md`](./docs/core-logic.md)。
5. **应用分类已砍掉**：不再维护 `app_categories` 配置和 `category` 字段。
6. **UI 主题**：改 Dashboard 样式时同步检查 `theme.ts`、`App.vue`、`TimelineWindows.vue`。
7. **布局滚动**：不要在页面级容器使用 `min-height: 100vh`；滚动交给 `App.vue` 的 `n-layout-content`。
8. **🔴 跨平台强约束**：任何平台相关代码必须通过条件编译隔离，并为不支持的平台留降级路径。详见「代码风格与约定」。
9. **🔴 不要自动启动 dev server**：前端改动完成后，先运行静态检查（`pnpm vue-tsc --noEmit`、`pnpm build`、`cd src-tauri && cargo check`）。**禁止调用 `pnpm dev` 或 `pnpm tauri dev` 启动服务器**；如需可视化验证，应连接用户已启动的服务器，使用 Playwright 截图，由用户自己决定是否启动服务。
