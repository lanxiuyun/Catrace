# Catrace — Agent Guide

> 本文档面向 AI 编程助手。

---

## 项目概述

Catrace 是一款桌面端工具，帮助用户平衡工作与休息。

- **核心功能**：后台静默监听键鼠活动，判断用户是否处于连续工作状态；当连续活跃时间超过阈值时，通过系统通知提醒用户休息。
- **隐私承诺**：不偷拍屏幕、不上传数据，所有信息保存在用户本地。
- **当前状态**：**已实现核心功能**，前端 Dashboard 可查看今日活动与统计，Rust 后端已完成采样、判定、通知、数据库全流程。

---

## 仓库现状

```
.
├── README.md
├── AGENTS.md
├── package.json          # pnpm + Vite + Vue 3
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/                  # Vue 3 前端
│   ├── api/tauri.ts
│   ├── assets/
│   ├── components/
│   │   ├── Timeline.vue        # 详细视图：24h 分钟级色块热力图（CSS Grid）
│   │   └── TimelineWindows.vue # 概览视图：block 卡片网格（可展开整行）
│   ├── router/index.ts
│   ├── utils/
│   │   └── timeBlocks.ts       # 前瞻式 block 切分（前后端共用逻辑）
│   ├── views/
│   │   ├── Dashboard.vue
│   │   ├── Settings.vue              # 设置页：提醒偏好 + 提醒设置 + 系统 + 链接
│   │   ├── Debug.vue                 # 视频检测与提醒窗口调试页面
│   │   ├── ReminderToast.vue         # Toast 提醒窗口（堆叠通知卡片）
│   │   ├── ReminderPopup.vue         # 弹窗提醒窗口
│   │   └── ReminderFullscreen.vue    # 全屏提醒窗口
│   ├── App.vue                 # 布局 + naive-ui 主题注入
│   ├── theme.ts                # 统一色板 + naive-ui themeOverrides
│   ├── main.ts
│   └── vite-env.d.ts
├── src-tauri/            # Tauri 2 + Rust
│   ├── src/
│   │   ├── main.rs             # 入口，调用 lib::run()
│   │   ├── lib.rs              # 全部业务逻辑（采样、结算、通知、命令）
│   │   ├── reminder.rs         # 提醒状态机 ReminderState + 单元测试
│   │   ├── reminder_toast.rs   # Toast 窗口位置计算与尺寸调整
│   │   └── db.rs               # rusqlite 封装
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── ...
└── public/
```

> **注意**：Rust 侧未按原分层目录（`input/`、`engine/` 等）实现，而是将所有逻辑集中在 `lib.rs` 中，通过模块级函数组织。

---

## 已落地的技术栈

| 层级 | 选型 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3 + TypeScript + Vite + naive-ui |
| 图表 | **未使用 ECharts**（时间轴用 CSS Grid 实现） |
| 后端（Rust）| rdev（键盘，Windows/Linux）、device_query（鼠标 + macOS 键盘）、rusqlite（DB）、tokio、active-win-pos-rs（焦点窗口）、tauri-plugin-autostart、tauri-plugin-opener、tauri-plugin-window-state、tauri-plugin-single-instance |

---

## 核心逻辑（已实现）

1. **采样**（`lib.rs`）
   - 每 2 秒检查鼠标光标位置（`device_query`）。
   - 全局监听键盘按下事件，2 秒内去重：
     - **Windows / Linux**：使用 `rdev`。
     - **macOS**：`rdev` 在解析按键名称时会调用 `TISGetInputSourceProperty`，该 API 在非主线程/某些输入法下会崩溃（Narsil/rdev #103 #146），因此 macOS 改用 `device_query::DeviceEventsHandler` 的事件回调，仅检测按键发生而不解析字符。
2. **分钟判定**（`lib.rs`）
   - 每分钟00秒结算一次：该分钟内活动次数 ≥ 3 → 标记为**活跃**；否则标记为**休息**。
   - 键鼠监听是独立的实时线程，持续累积活动次数，每分钟00秒读取并归零。
   - **视频/流媒体检测**：若键鼠活动不足，但检测到正在播放视频，该分钟仍视为**活跃**。
     - **Windows**：优先尝试 `GlobalSystemMediaTransportControlsSessionManager` 枚举系统媒体会话，只要有会话处于 **Playing** 状态即算活跃（不限 `PlaybackType`，覆盖浏览器、UWP 播放器、Spotify 等）。GSMTCSM API 调用成功时完全信任其结果（无 Playing 会话也视为不活跃），仅在 API 调用失败时才回退到窗口标题 + 进程名关键词匹配。
     - **macOS / Linux**：直接走窗口标题 + 进程名关键词匹配（YouTube、Bilibili、Netflix、VLC 等），基于 `active-win-pos-rs`。
3. **Block 切分与提醒**（`db.rs` + `lib.rs` + `reminder.rs` + `utils/timeBlocks.ts`）
   - 从首个有记录的时间点开始，向后以 `window_minutes` 为单元切分 block：
     - 若在窗口内遇到连续 `break_minutes` 休息 → 切为**休息 block**（到连续休息结束）。
     - 若窗口内无足够连续休息 → 切为**活跃 block**（固定 `window_minutes` 长度）。
   - **关键约束**：切分只考虑「已发生的分钟」（索引 ≤ `nowIdx`）。未来未记录的 `null` 不会被当作「连续休息」来结束当前 block，避免切出从当前时间直通午夜的幽灵休息 block。
   - 当前时间所在为未完结的「进行中 block」。
   - 提醒逻辑（`db.rs` 切分 block + `lib.rs` 触发通知）：
     - 前一个已完成 block 为**活跃** → 弹出提醒（刚干完一波）。
     - 前一个已完成 block 为**休息**，当前进行中 block 长度 ≥ `window_minutes` → 弹出提醒（休息后又工作满一波）。
     - 其余情况不提醒。
   - 通知**不去做重**：只要条件满足，每分钟结算都会弹，直到用户连续休息够 `break_minutes`。
   - **休息即静音**：只要当前分钟在休息（无论是否达到 `break_minutes`），立即不提醒；恢复活跃后重新判断。
   - **自动间隔提醒**：通知触发后自动设置 `snooze_interval_minutes`（默认3分钟）的 snooze，到期后再次提醒。用户手动选择 5/10 分钟会覆盖自动间隔。
   - **Toast 提醒窗口**：采用独立透明 WebviewWindow + Vue 卡片实现，替代原 Windows 原生 Toast。支持多条通知堆叠显示，右下角依次排列，倒计时进度条，hover 暂停，离开恢复；每个卡片都有「5分钟后提醒」「10分钟后提醒」「跳过本次」按钮，点击后直接更新 `ReminderState`，无需打开主窗口。

**提醒场景示例（`window=45, break=5, snooze_interval=3`）**

> 关键前提：提醒只在**当前分钟活跃**时检查。休息分钟不检查，因此休息期间**绝不弹通知**。

| 场景 | 时间线 | 结果 |
|---|---|---|
| 活跃 45min → 继续活跃 | 0:00~0:44 活跃 → **0:45 弹** → 自动 snooze 3min → **0:48 再弹** → 0:51 再弹... | ✅ 每 3 分钟提醒一次 |
| 活跃 45min → 休息 1min → 继续活跃 | 0:00~0:44 活跃 → 0:45 休息（不催）→ **0:46 弹** → 自动 snooze 3min → 0:49 再弹... | ✅ 休息即停，复工后按间隔催 |
| 活跃 45min → 休息 4min → 恢复活跃 | 0:00~0:44 活跃 → 0:45~0:48 休息（不催）→ **0:49 弹** → 自动 snooze 3min → 0:52 再弹... | ✅ 休息不够，复工即催 |
| 活跃 45min → 休息够 5min | 0:00~0:44 活跃 → 0:45~0:49 休息（不催）→ 0:50 休息够 5min | ❌ 不提醒。休息期间不检查；休息够后 should_notify=false，恢复活跃需再工作满窗口 |
| 活跃 45min → 休息 5min → 再活跃 45min | 0:00~0:44 活跃 → 0:45~0:49 休息（不催）→ 0:50~1:34 活跃 → **1:35 弹** → 自动 snooze 3min → 1:38 再弹... | ✅ 提醒 |
| 活跃 40min，进行中 | 0:00~0:39 活跃（未满窗口） | ❌ 不提醒 |
| 活跃 40min → 休息 5min → 再活跃中 | 0:00~0:39 活跃 → 0:40~0:44 休息 → 0:45~0:47 活跃（未满窗口） | ❌ 不提醒 |
| 全天休息 | 一直在休息 | ❌ 不提醒 |
| 用户点击「5分钟后提醒」 | 0:45 弹 → 用户点击 5min → **0:50 弹**（覆盖自动 3min 间隔） | ✅ 用户选择优先 |

> 规律：活跃 block 完成后，**下一个活跃分钟**会弹；之后按 `snooze_interval_minutes` 间隔重复提醒。用户手动选择 5/10 分钟会覆盖自动间隔。但只要**当前分钟在休息**，立即停止提醒并清除 snooze；恢复活跃后重新判断。

4. **Toast 提醒窗口**（`reminder_toast.rs` + `ReminderToast.vue`）
   - Rust 侧创建独立无边框 WebviewWindow，透明背景，定位到工作区右下角；窗口复用，多次提醒时通过 `addToastNotification` 往已有窗口追加卡片。
   - 前端 `ReminderToast.vue` 维护一个通知卡片列表，新卡片从右侧滑入；关闭时通过 FLIP 动画让下方卡片平滑补上。
   - 每张卡片 8 秒自动消失，鼠标 hover 暂停计时，离开时继续；支持「5分钟后提醒」「10分钟后提醒」「跳过本次」。
   - 调试开关 `toast_debug_mode` 可在 Debug 页开启，此时 Toast 窗口显示半透明黄色背景，便于排查布局/点击问题。

5. **全屏背景图存储**（`lib.rs`）
   - 前端上传的 data URL 经 base64 解码后保存为磁盘文件（`app_data_dir/bg/fullscreen_bg.{ext}`），DB 只存文件路径，避免 SQLite 存储大 blob。
   - 读取时通过 `resolve_bg_for_frontend()` 统一将文件路径转回 data URL 返回前端。
   - 默认背景图使用 bundled `src-tauri/assets/catrace.png`，首次启动时复制到 `app_data_dir/bg/`。
   - 全屏提醒窗口使用双层背景：底层模糊放大铺满（`filter: blur(40px)`），上层清晰原图居中 contain。
   - 进入全屏提醒路由时，`App.vue` 通过 CSS class 切换 `html/body/#app` 背景为透明，让全屏背景图穿透显示。
   - `set_fullscreen_settings` 在 `element_transforms` 为空字符串时保留已有值，避免 Settings.vue 调整背景/透明度/填充模式时覆盖用户在 ReminderFullscreen.vue 中调整的元素位置/缩放/旋转。

6. **全屏提醒元素独立编辑**（`ReminderFullscreen.vue`）
   - 每个元素（标题、正文、倒计时、按钮）可独立调整位置、缩放、旋转。
   - 数据存储为 JSON 字符串 `fullscreen_element_transforms`，包含每个元素的 x, y, scale, rotate。
   - 交互流程：点击右上角锁图标进入编辑模式 → 点击元素选中 → 拖动改变位置 / 滚轮调整缩放 / 滑块调整旋转 → 点击锁定保存。
   - 编辑模式下元素显示虚线边框，选中元素显示紫色边框和编辑工具栏。

---

## 配置项

| 配置名 | 说明 | 默认值 |
|--------|------|--------|
| `window_minutes` | 工作窗口长度（分钟） | 45 |
| `break_minutes` | 连续休息多少分钟算断开（分钟） | 5 |
| `snooze_interval_minutes` | 活跃满后重复提醒间隔（分钟） | 3 |
| `silent_start` | 开机自启时不显示主窗口 | false |
| `video_active_enabled` | 视频计入活跃（开启后看视频算活跃，活跃时长到达后仍会提醒休息） | true |
| `locale` | 界面语言（zh-CN / en-US） | 自动检测系统语言，回退 zh-CN |
| `reminder_mode` | 提醒模式（toast / popup / fullscreen） | toast |
| `fullscreen_bg_image` | 全屏背景图（data URL 或文件路径） | bundled catrace.png |
| `fullscreen_opacity` | 全屏遮罩透明度（0-100） | 80 |
| `fullscreen_fit_mode` | 背景填充模式（contain / cover / fill） | contain |
| `fullscreen_element_transforms` | 全屏元素变换（JSON，包含 title/body/countdown/actions 的 x,y,scale,rotate） | 默认居中 |

**提醒操作（进程级状态，重启后重置）**

| 操作 | 效果 |
|------|------|
| 跳过本次 | 当前 block 完成前不再提醒 |
| 5分钟后提醒 | 推迟 5 分钟，期间不弹通知 |
| 10分钟后提醒 | 推迟 10 分钟，期间不弹通知 |
| 自动间隔提醒 | 通知触发后自动设置 `snooze_interval_minutes`（默认3分钟）间隔，到期后再次提醒 |

> 只要当前分钟在休息，系统**自动不提醒**，同时清除 snooze。恢复活跃后重新判断。


---

## 实际目录结构

### Rust 后端（Tauri 侧）

```
src-tauri/src/
├── main.rs     -- Tauri 入口，仅调用 lib::run()
├── lib.rs      -- 全部业务逻辑：
│                 · 键盘/鼠标采样线程（实时累积活动次数）
│                 · 每分钟00秒结算 + 写入 DB
│                 · 滑动窗口检测 + 通知
│                 · #[tauri::command] 暴露给前端
│                 · 系统托盘
├── reminder.rs -- 提醒状态机 ReminderState + 单元测试
└── db.rs       -- rusqlite 读写封装 + 单元测试
```

> 原计划拆分为 `input/`、`engine/`、`notify.rs`、`commands.rs` 等模块，实际为了快速落地全部集中在 `lib.rs`。后续如需扩展可再拆分。

### 前端（Vue 3）

```
src/
├── i18n/
│   ├── index.ts         -- vue-i18n 配置（zh-CN / en-US）
│   └── locales/
│       ├── zh-CN.ts     -- 中文翻译
│       └── en-US.ts     -- 英文翻译
├── views/
│   ├── Dashboard.vue        -- 今日统计四卡片 + 今日活动（概览/详细切换）
│   ├── Settings.vue         -- 设置页：提醒偏好（窗口/休息/视频活跃）+ 提醒设置（模式/内容/全屏背景/测试）+ 系统 + 链接
│   ├── Debug.vue                -- 视频检测与提醒窗口调试页面
│   ├── ReminderToast.vue        -- Toast 提醒窗口（堆叠通知卡片）
│   ├── ReminderPopup.vue        -- 弹窗提醒窗口
│   └── ReminderFullscreen.vue   -- 全屏提醒窗口
├── components/
│   ├── Timeline.vue         -- 24h × 60min 色块热力图（CSS Grid）
│   └── TimelineWindows.vue  -- 概览 block 卡片网格（自适应列数，点击展开整行）
├── utils/
│   └── timeBlocks.ts    -- computeTimeBlocks / mergeRestBlocks
├── router/
│   └── index.ts         -- hash 路由（/dashboard, /settings, /debug, /reminder-toast, /reminder-popup, /reminder-fullscreen）
├── api/
│   └── tauri.ts         -- invoke 调用 Rust 命令的封装
├── theme.ts             -- 色板常量 + naive-ui GlobalThemeOverrides
├── App.vue              -- 侧边栏布局 + NConfigProvider 主题注入（含 naive-ui  locale）
└── main.ts              -- Vue 入口
```

### Dashboard 布局（当前）

```
┌──────────┬─────────────────────────────────────┐
│ Catrace  │  今日统计 / 日期                     │
│ 概览     │  ┌────┐ ┌────┐ ┌────┐ ┌────┐       │
│ 设置     │  │活跃│ │休息│ │占比│ │时段│       │
│          │  └────┘ └────┘ └────┘ └────┘       │
│          │  ┌─ 今日活动 ──── [概览|详细] ─┐   │
│          │  │  block 列表 / 24h 热力图    │   │
│          │  └─────────────────────────────┘   │
└──────────┴─────────────────────────────────────┘
```

- **已移除**：右上角「活跃中/休息中」状态标签、右侧「活跃 vs 休息」环形图面板。
- **统计区**：四张白卡片（自定义 markup，非 `NStatistic`），彩色圆点 + 按类型着色的数值；响应式整数列（宽屏 4 列 / 中等 2 列 / 窄屏 1 列），padding 紧凑。
  - **活跃**：按 **block 语义** 计算——活跃 block 的全部时长（含里面的休息分钟）+ 休息 block 里实际活跃的分钟。
  - **休息**：休息 block 里实际休息的分钟。
  - **活跃占比**、**活跃时段**：基于上述 block 语义统计。
- **滚动**：根节点 `overflow: hidden`，仅 `n-layout-content` 区域在内容溢出时滚动；页面内不使用 `min-height: 100vh`。

### 时间轴实现说明

**详细视图**（`Timeline.vue`，切换后展示）：
- **技术**：CSS Grid（24 行 × 60 列），每个 `<div>` 色块代表 1 分钟，不是 SVG / Canvas / ECharts。
- **布局**：行 = 小时（00-23），列 = 分钟（0-59）。
- **交互**：鼠标在网格上移动，通过坐标计算对应分钟索引，显示时间与状态。
- **当前时间**：对应色块加红色脉冲动画高亮。
- **图例**：活跃（紫 `#7C3AED`）、休息（绿 `#059669`）、无记录（灰）、当前时间（红框）。

**概览视图**（`TimelineWindows.vue`，默认展示）：
- 基于前瞻式 block 切分算法（`utils/timeBlocks.ts`），将全天切分为**活跃 block** 和 **休息 block**。
- 从首个记录开始向后扫描：窗口内遇连续 `break_minutes` 休息 → 休息 block；否则 → 活跃 block（固定 `window_minutes` 长度）。
- 连续休息 block 自动合并，活跃 block 保持独立。
- **卡片网格**：CSS Grid `repeat(auto-fit, minmax(15.625rem, 1fr))`，列数随容器自适应，卡片最小 250px 并自动拉伸填满整行。每张卡片显示时间范围 · 时长 · 状态标签；当前 block 紫边框高亮 + 「进行中」标签 + 涟漪圆点。
  - 休息卡片若内部包含活跃分钟，在时长右侧 subtle 显示「活跃 Xm」（11px 淡灰，0 时不显示）。
  - 时间范围：已完成 block 的结束时间显示为 **不包含边界**（`endTs + 60`），例如 `00:00 → 00:45` 对应 45 分钟，和时长对齐；进行中 block 结束时间取当前实时时间。
  - 时长：已完成 block = 记录条数（`endIdx - startIdx`）；进行中 block = 从 block 起始到现在（`nowIdx - startIdx`）。
  - 标签：已完成 block 显示「活跃」/「休息」；进行中 block 只显示「进行中」，不显示状态。
- **整行展开**：点击任意卡片，该卡片所在 CSS Grid 行内的所有卡片同步展开/收起。展开内容：每 10 分钟一行的时间标签 + 混合分钟条；时间标签同样使用 `+60` 显示不包含边界（如 `00:00–00:10` 表示 10 分钟）。
  - **混合分钟条**：一行内连续同状态的分钟先合并为 segment，再根据长度选择渲染方式：
    - **连续色条（segment）**：连续 ≥5 分钟的段落，用 flex 比例分配宽度（高度 8px），段之间留 1px 间隙。
    - **独立方块（cells）**：连续 <5 分钟的段落，拆分为每分钟的独立小方块（`8×8px`），方块之间留 1px 间隙，视觉上类似详细视图的分钟色块。
  - **hover**：segment 或单个 cell 上浮 `translateY(-2px)` + 亮度提升。segment 的 tooltip 显示该段起止时间与时长（如 `09:00–09:05 · 5min`）；cell 的 tooltip 显示该分钟的精确时间与状态（如 `09:02 · 活跃`）。
  - **填满宽度**：色条与方块容器共用 flex 比例自适应填满卡片可用宽度。
  - **末行非满宽**：展开后最后一行若不足 10 分钟，色条只按实际时长占比显示宽度，剩余部分留白，避免视觉误导。

### UI 主题（`theme.ts`）

| 用途 | 色值 |
|------|------|
| 页面背景 | `#F7F5FA` |
| 卡片 / 侧边栏 | `#FFFFFF` |
| 边框 | `#EBE6F2` |
| 主色（活跃） | `#7C3AED` / `#6D28D9` |
| 辅色（休息） | `#059669` |
| 标题文字 | `#2E1065` |
| 次要文字 | `#8B7AAB` |

- `App.vue` 通过 `NConfigProvider :theme-overrides` 统一 naive-ui 组件（Menu、Radio、Button、Slider 等）配色。
- 设计原则：**克制、干净**——白卡片 + 细边框 + 轻阴影；颜色主要用于圆点、数值和标签，避免大面积渐变或装饰光斑。

### 数据库（SQLite）

```sql
-- 每分钟记录
CREATE TABLE records (
    timestamp INTEGER PRIMARY KEY,  -- 整分钟时间戳
    is_active INTEGER,              -- 0 = 休息, 1 = 活跃
    process_name TEXT,              -- 当前焦点窗口进程名
    category TEXT                   -- [已弃用] 原应用分类，现保留列以兼容旧数据
);

-- 配置键值对
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

---

## 开发进度

| 步骤 | 内容                                                              | 状态 |
|----|-----------------------------------------------------------------|-----|
| 1  | Rust 采样：rdev 键盘（Windows/Linux）+ device_query 鼠标/键盘（macOS）     | ✅ |
| 2  | 每分钟活跃判定，写入 SQLite                                               | ✅ |
| 3  | 滑动窗口算法 + 系统通知                                                   | ✅ |
| 4  | Tauri 套壳 + Vue 3 前端                                             | ✅ |
| 5  | Settings 页：滑块改配置（自动保存）                                          | ✅ |
| 6  | Dashboard：今日活动（详细/概览双视图）+ 统计                                    | ✅ |
| 7  | 系统托盘图标                                                          | ✅ |
| 8  | ~~应用分类名单~~                                                      | ❌ 已砍掉 |
| 22 | 提醒设置：skip / snooze（3/5分钟）状态管理                                   | ✅ |
| 23 | 休息即静音：当前分钟在休息则不提醒                                               | ✅ |
| 24 | ~~Windows Toast 通知带按钮（tauri-winrt-notification）~~                   | ~~✅~~ 已重构为跨平台 Vue Toast |
| 25 | ~~AUMID 注册：通知显示应用名称~~                                               | ~~✅~~ 随原生 Toast 移除 |
| 26 | 弹窗提醒模式                                                          | ✅ |
| 26 | 全屏提醒模式（双层背景 + 自定义背景图 + 透明度设置）                                  | ✅ |
| 9  | Dashboard UI 初版（统计卡片 + 环形图 + 双栏布局）                              | ✅（已被步骤 11 取代） |
| 18 | 记住窗口位置和大小，下次启动恢复                                                | ✅ |
| 10 | 概览视图：前瞻式 block 切分列表（默认概览）                                       | ✅ |
| 11 | Dashboard UI 精简重构：去环形图/状态标签、紧凑列表、统一主题、修复滚动条                     | ✅ |
| 12 | 修复进行中 block 显示未来时间：computeTimeBlocks 截断到 nowIdx + 1，展开视图截断到当前分钟 | ✅ |
| 13 | 概览视图整行展开：点击卡片同步展开/收起同行全部卡片                                      | ✅ |
| 14 | UI 微调：卡片自适应列数、进行中涟漪圆点、去背景色、分割线加深、统计卡片响应式、窗口最小尺寸 800×600         | ✅ |
| 15 | 概览展开视图重构：迷你方块改为连续色条、hover 上浮高亮、自定义 tooltip 显示起止时间 + 时长、色条自适应宽度  | ✅ |
| 16 | 展开视图混合渲染：连续 ≥5 分钟用色条，<5 分钟用独立方块，tooltip 分别显示段/单分钟信息             | ✅ |
| 17 | 展开视图末行宽度修正：不足 10 分钟时色条按实际占比显示，右侧留白                              | ✅ |
| 18 | 概览休息卡片显示穿插活跃时间：与时长同行右对齐，0 时隐藏                                   | ✅ |
| 19 | 设置页文本优化 + 开机自启/静默启动开关                                           | ✅ |
| 20 | 关闭不退出最小化到托盘，双击托盘显示主页面                                           | ✅ |
| 21 | 设置页两栏布局 + 相关链接（GitHub/更新日志/问题反馈）                                | ✅ |
| 27 | 视频检测：GSMTCSM 优先，API 失败时关键词兜底，去掉 Video 类型限制                      | ✅ |
| 28 | 视频检测调试页面（实时显示 GSMTCSM 会话、焦点窗口、键鼠计数）                             | ✅ |
| 29 | 「视频计入活跃」开关设置                                                    | ✅ |
| 30 | 文案中性化：「工作」→「活跃」                                                 | ✅ |
| 31 | 设置页去掉保存按钮，提醒偏好滑块自动保存                                            | ✅ |
| 32 | 国际化 i18n：vue-i18n 前端全量替换 + Rust 后端通知/托盘本地化                      | ✅ |
| 33 | 支持 zh-CN / en-US 双语，设置页语言切换器                                    | ✅ |
| 34 | 默认自动检测系统语言（navigator.language），首次启动保存到 DB                       | ✅ |
| 35 | 设置页重构：拆分为「提醒偏好」与「提醒设置」两个独立卡片                                    | ✅ |
| 36 | 提醒模式切换（通知提醒 / 弹窗提醒 / 全屏提醒），全屏背景图与透明度设置仅全屏模式下显示                  | ✅ |
| 37 | 全屏背景图上传 UI 重设计：预览卡片 + 毛玻璃操作按钮 + 虚线拖拽区域                          | ✅ |
| 38 | 文案统一：「通知」→「提醒」                                                  | ✅ |
| 39 | 全屏提醒元素独立编辑：标题/正文/倒计时/按钮可独立调整位置、缩放、旋转                            | ✅ |
| 40 | 单例模式：重复启动应用时聚焦到已有实例主窗口                                                    | ✅ |
| 41 | Toast 提醒重构：Vue 透明窗口 + 堆叠卡片 + FLIP 动画 + 调试模式，移除 Windows 原生 Toast 依赖            | ✅ |
| 42 | Dashboard 统计隐藏开关，避免他人看到休息时长                                  | ✅ |

---

## 构建与运行命令（已验证）

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

**🔴 强约束**：每次修改版本号前，**必须先读取** [版本号管理](./docs/version-management.md)，严格按文档要求同步更新所有文件。

---

## 代码风格与约定

- 项目文档与计划全部使用**中文**撰写，代码注释保持一致。
- 前端使用 **Vue 3 Composition API + `<script setup>` + TypeScript**。
- Rust 当前未按功能拆分子模块（全部在 `lib.rs`），后续扩展时建议拆分。
- UI 配色统一维护在 `src/theme.ts`，改主题时优先改此文件。
- **🔴 强约束 — 跨平台**：Rust 后端开发任何功能（尤其是新增依赖、系统调用、原生 API、文件路径处理、通知、托盘、键鼠监听等）**必须首先评估跨平台兼容性**。Catrace 目标平台为 **Windows / macOS / Linux**，禁止引入仅限单一平台的代码而不提供条件编译或降级方案。新增 `Cargo.toml` 依赖时，必须检查该 crate 是否支持目标平台；涉及平台专属 API（如 `windows` crate 用于 GSMTCSM 媒体会话检测）时，必须使用 `#[cfg(target_os = ...)]` 隔离，并为其他平台提供等效实现或优雅降级。

---

## 测试策略

- **Rust**：共 18 个单元测试，分布在 `db.rs`（14 个）和 `reminder.rs`（4 个）：

  **Block 切分（`db.rs`，3 个）**
  | 测试名 | 说明 |
  |---|---|
  | `test_compute_blocks_basic` | 45 活跃 + 5 休息 + 45 活跃，验证切分结果 |
  | `test_compute_blocks_all_active` | 全活跃记录切成多个 Active block |
  | `test_compute_blocks_all_rest` | 全休息记录切成一个 Rest block |

  **提醒逻辑（`db.rs`，11 个）**
  | 测试名 | 覆盖场景 | 说明 |
  |---|---|---|
  | `test_no_notify_empty` | 场景 8 | 全天无记录 → should_notify=false |
  | `test_no_notify_during_ongoing` | 场景 6 | 活跃 40min（未满窗口）→ should_notify=false |
  | `test_no_notify_after_rest_block` | — | 休息 block 完成后 → should_notify=false |
  | `test_no_notify_rest_then_short_active` | 场景 7 | 活跃 40min → 休息 5min → 再活跃 3min → should_notify=false |
  | `test_notify_after_active_block_completes` | 场景 1 | 活跃 45min → 继续活跃 → should_notify=true |
  | `test_notify_active_then_rest_until_break` | 场景 4 | 活跃 45min → 休息，前 4min should_notify=true，第 5min false |
  | `test_notify_active_then_keep_active` | 场景 1 延长 | 活跃 45min → 继续活跃 10min → should_notify 持续 true |
  | `test_notify_short_rest_then_active` | 场景 2 | 活跃 45min → 休息 1min → 再活跃 45min → should_notify=true |
  | `test_notify_after_rest_then_active` | 场景 5 | 活跃 40min → 休息 5min → 再活跃 45min → should_notify=true |
  | `test_notify_full_cycle_active_rest_active` | 场景 5 完整 | 活跃 45min → 休息 5min → 再活跃 45min，验证完整周期 |
  | `test_notify_no_duplicate_boundary` | 场景 1 | 同一数据多次调用，boundary 稳定 |

  **提醒状态机（`reminder.rs`，4 个）**
  | 测试名 | 说明 |
  |---|---|
  | `test_reminder_state_snooze` | `is_snoozed()` 正确判断未来/过去时刻 |
  | `test_reminder_state_skip` | `is_skipped()` 在不同 boundary 下的行为 |
  | `test_snooze_interval_overridden_by_user_choice` | 用户点击「5分钟」会覆盖自动设置的 3 分钟 snooze |
  | `test_snooze_auto_interval_expiry` | 自动 snooze 间隔到期后不再处于 snoozed 状态 |

- **前端**：目前无自动化测试，依赖手动验证（`pnpm tauri dev` 观察界面）。

---

## 安全与隐私

- 全局键鼠监听仅计数，不记录按键内容或鼠标轨迹坐标。
- 数据库文件保存在 `app_data_dir/catrace.db`，不上传。
- `rdev`（Windows/Linux）与 `device_query`（macOS 键盘/鼠标）、`active-win-pos-rs` 需要系统权限（macOS Accessibility / Windows UI Access）。

---

## 对 AI 助手的提示

1. **代码已存在**：项目已完整初始化（Tauri / Vue / Vite / naive-ui），无需再执行框架初始化命令。
2. **优先读代码再改**：Rust 逻辑集中在 `src-tauri/src/lib.rs`，前端逻辑在 `src/views/`、`src/components/`、`src/theme.ts`。
3. **保持中文文档**：README、AGENTS 等文档均为中文，新增文档继续使用中文。
4. **Timeline 实现方式**：详细视图使用 CSS Grid（24×60 的 `<div>` 网格），不是 SVG / Canvas / ECharts；概览视图使用前瞻式 block 切分**卡片网格**（CSS Grid `repeat(auto-fit, minmax(15.625rem, 1fr))`），点击卡片展开整行迷你色块。
5. **应用分类已砍掉**：不再维护 `app_categories` 配置和 `category` 字段。
6. **UI 主题**：见上文「UI 主题」一节；改 Dashboard 样式时同步检查 `theme.ts`、`App.vue`、`TimelineWindows.vue`。
7. **布局滚动**：不要在页面级容器使用 `min-height: 100vh`（会与 padding 叠加导致多余滚动条）；滚动交给 `App.vue` 的 `n-layout-content`。
8. **🔴 跨平台强约束**：修改 Rust 后端时，**任何平台相关代码必须通过条件编译隔离**，并为不支持的平台留降级路径。禁止在公共逻辑中硬编码 Windows 专属 API 调用。优先选用跨平台 crate；若必须使用平台专属 crate，需在 `Cargo.toml` 中按 `target.'cfg(...)'.dependencies` 声明，并在代码中用 `#[cfg(...)]` 包裹。
