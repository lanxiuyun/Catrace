> 本文档说明 Catrace 的核心业务逻辑与 UI 实现细节，面向需要深入理解或修改系统的开发者。快速上手请阅读 `AGENTS.md`。

---

## 目录

- [采样与判定](#采样与判定)
- [Block 切分与提醒](#block-切分与提醒)
- [喝水提醒](#喝水提醒)
- [Toast / Popup 提醒窗口](#toast--popup-提醒窗口)
- [全屏提醒](#全屏提醒)
- [启动事件上报](#启动事件上报)
- [自动更新检查](#自动更新检查)
- [Dashboard 与时间轴](#dashboard-与时间轴)
- [UI 主题](#ui-主题)
- [数据库](#数据库)

---

## 采样与判定

### 采样（`lib.rs`）

- 每 2 秒检查鼠标光标位置（`device_query`）。
- 全局监听键盘按下事件，2 秒内去重：
  - **Windows / Linux**：使用 `rdev`。
  - **macOS**：`rdev` 在解析按键名称时会调用 `TISGetInputSourceProperty`，该 API 在非主线程/某些输入法下会崩溃（Narsil/rdev #103 #146），因此 macOS 改用 `device_query::DeviceEventsHandler` 的事件回调，仅检测按键发生而不解析字符。

### 分钟判定（`lib.rs`）

- 每分钟 00 秒结算一次：该分钟内活动次数 ≥ 3 → 标记为**活跃**；否则标记为**休息**。
- 键鼠监听是独立的实时线程，持续累积活动次数，每分钟 00 秒读取并归零。
- **媒体计入活跃**：若键鼠活动不足，但检测到正在进行屏幕消费（如看视频、听音乐、看直播），该分钟仍视为**活跃**。
  - **Windows**：使用 WASAPI 枚举系统音频输出会话，直接检查每个音频输出进程的进程名是否在「排除列表」内；任一非排除列表中的进程正在发声即算活跃。无音频输出时直接视为不活跃（接受静音看视频被误判为不活跃）。对受保护进程（如 `audiodg.exe`）若句柄方式无法获取名称，会回退到 Toolhelp32 进程快照读取进程名。
  - **macOS / Linux**：暂未实现系统音频捕获，媒体计入活跃功能在该平台不可用（`is_media_active` 恒返回 `false`）。后续将通过跨平台音频 API 统一实现。
  - **排除列表可配置（Windows 专属）**：用户可在 Settings 页的「视频与音乐」Card 中以纯文本形式自定义排除列表，每行一个进程名（不区分大小写），编辑后 500ms 自动保存；首次使用自动填充默认系统进程列表。开关关闭时不显示该列表。

---

## Block 切分与提醒

### Block 切分（`db.rs` + `utils/timeBlocks.ts`）

- 从首个有记录的时间点开始，向后以 `window_minutes` 为单元切分 block：
  - 若在窗口内遇到连续 `break_minutes` 休息 → 切为**休息 block**（到连续休息结束）。
  - 若窗口内无足够连续休息 → 切为**活跃 block**（固定 `window_minutes` 长度）。
- **关键约束**：切分只考虑「已发生的分钟」（索引 ≤ `nowIdx`）。未来未记录的 `null` 不会被当作「连续休息」来结束当前 block，避免切出从当前时间直通午夜的幽灵休息 block。
- 当前时间所在为未完结的「进行中 block」。

### 提醒逻辑（`db.rs` + `lib.rs` + `reminder.rs`）

- 前一个已完成 block 为**活跃** → 弹出提醒（刚干完一波）。
- 前一个已完成 block 为**休息**，当前进行中 block 长度 ≥ `window_minutes` → 弹出提醒（休息后又工作满一波）。
- 其余情况不提醒。
- 通知**不去做重**：只要条件满足，每分钟结算都会弹，直到用户连续休息够 `break_minutes`。
- **休息即静音**：只要当前分钟在休息（无论是否达到 `break_minutes`），立即不提醒；恢复活跃后重新判断。
- **自动间隔提醒**：通知触发后自动设置 `snooze_interval_minutes`（默认 3 分钟）的 snooze，到期后再次提醒。用户手动选择 5/10 分钟会覆盖自动间隔。
- **休息计时（Toast 模式）**：当活跃 block 已触发提醒、用户随后进入休息时，Toast 窗口会追加一个绿色液体球计时器，球内液体高度随休息进度上升，并带有波浪流动与气泡动画；球心显示已连续休息分钟数。满 `break_minutes` 后卡片保持显示并继续累计休息时长；若恢复活跃，卡片停留几秒后自动消失。Popup / Fullscreen 模式下不显示该计时器。

### 提醒场景示例（`window=45, break=5, snooze_interval=3`）

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
| 活跃 45min → 开始休息（Toast 模式） | 0:00~0:44 活跃 → **0:45 弹** → 0:45 起休息 → Toast 显示绿色液体球计时器，球内液面随休息进度上升 → 累计到 5 分钟后显示「休息已完成」 | ✅ 休息期间可视化计时 |

> 规律：活跃 block 完成后，**下一个活跃分钟**会弹；之后按 `snooze_interval_minutes` 间隔重复提醒。用户手动选择 5/10 分钟会覆盖自动间隔。但只要**当前分钟在休息**，立即停止提醒并清除 snooze；恢复活跃后重新判断。

### 提醒操作（进程级状态，重启后重置）

| 操作 | 效果 |
|------|------|
| 跳过本次 | 当前 block 完成前不再提醒 |
| 5分钟后提醒 | 推迟 5 分钟，期间不弹通知 |
| 10分钟后提醒 | 推迟 10 分钟，期间不弹通知 |
| 自动间隔提醒 | 通知触发后自动设置 `snooze_interval_minutes`（默认 3 分钟）间隔，到期后再次提醒 |

---

## 喝水提醒

由 `water.rs` + `lib.rs` + `WaterWidget.vue` 实现。

- `water.rs` 集中管理喝水提醒：状态机 `WaterReminderState`、Tauri 命令、Toast 通知、每分钟结算检查。
- 在每分钟活跃结算时，`lib.rs` 调用 `water::check_and_notify(...)`；若距上次喝水超过 `water_interval_minutes`，则通过右下角 Toast 提醒用户喝水。
- 仅在当前分钟为**活跃**时检查；休息期间不提醒，恢复活跃后重新判断。
- 触发后自动按 `water_interval_minutes` 设置 snooze，避免短时间内重复弹窗。
- 用户可在 Dashboard 的 `WaterWidget.vue` 中手动记录「+1 次喝水」或删除最近一次记录；点击 Toast 的「已喝水」按钮也会立即记录并关闭通知。
- `WaterWidget` 仅在 `water_reminder_enabled` 开启时显示；关闭喝水提醒后 Dashboard 不再展示喝水统计。
- 喝水提醒 Toast 采用与 `WaterWidget` 统一的蓝色主题，与休息提醒的紫色主题区分。
- `WaterReminderState` 管理 snooze / last_reminder_sent，进程级状态，重启后重置。

---

## Toast / Popup 提醒窗口

由 `reminder_toast.rs` + `window_manager/` + `ReminderToast.vue` 实现。

- Rust 侧创建独立无边框 WebviewWindow，透明背景，定位到工作区右下角；窗口复用，多次提醒时通过 `addToastNotification` 往已有窗口追加卡片。
- 前端 `ReminderToast.vue` 维护一个通知卡片列表，新卡片从右侧滑入；关闭时通过 FLIP 动画让下方卡片平滑补上。
- 每张卡片 8 秒自动消失，鼠标 hover 暂停计时，离开时继续；支持「5分钟后提醒」「10分钟后提醒」「跳过本次」。
- 通知按 `kind` 区分主题：
  - **休息提醒**：紫色主题。
  - **喝水提醒**：与 Dashboard `WaterWidget` 统一的蓝色主题（圆点、进度条、标题、按钮均为蓝色系）。
  - **休息计时**：与 Dashboard 休息统计一致的绿色主题，以一个带液体流动与气泡动画的球体呈现休息进度，卡片不自动关闭，满 `break_minutes` 后继续累计休息时长。
- 调试开关 `toast_debug_mode` 可在 Debug 页开启，此时 Toast 窗口根节点会显示半透明黄色背景，便于排查布局/点击问题；切换后 Rust 侧通过 Tauri 事件 `catrace-toast-debug-changed` 广播状态，Toast 窗口前端监听并即时响应。
- **Windows 下不抢夺焦点**：通过 `window_manager` 设置 `WS_EX_NOACTIVATE` 并使用 `SW_SHOWNOACTIVATE` 显示，文件重命名、输入框编辑时弹出通知不会打断当前输入状态。

### 无焦点提醒窗口管理（`window_manager/`）

- **目标平台**：Windows 完整实现；macOS / Linux 暂回退到普通显示（后续可接入 `NSPanel`）。
- **核心 Win32 标志**：`WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE` + `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE | ...)`。
- **应用范围**：仅 `reminder-toast` 与 `reminder-popup` 使用无焦点显示；`reminder-fullscreen` 与主窗口保持原有强制聚焦/正常显示逻辑。
- **交互策略**：窗口内部按钮可正常点击响应，但不会激活窗口；Popup 点击「自定义」输入框时临时恢复可聚焦模式以便输入。
- **窗口复用**：Toast/Popup 关闭时调用 `window_manager::hide_window_internal` 隐藏而非销毁，避免下次创建时可能出现的焦点抖动。

---

## 全屏提醒

### 全屏背景图存储（`lib.rs`）

- 前端上传的 data URL 经 base64 解码后保存为磁盘文件（`app_data_dir/bg/fullscreen_bg.{ext}`），DB 只存文件路径，避免 SQLite 存储大 blob。
- 读取时通过 `resolve_bg_for_frontend()` 统一将文件路径转回 data URL 返回前端。
- 默认背景图使用 bundled `src-tauri/assets/catrace.png`，首次启动时复制到 `app_data_dir/bg/`。
- 全屏提醒窗口使用双层背景：底层模糊放大铺满（`filter: blur(40px)`），上层清晰原图居中 contain。
- 进入全屏提醒路由时，`App.vue` 通过 CSS class 切换 `html/body/#app` 背景为透明，让全屏背景图穿透显示。
- `set_fullscreen_settings` 在 `element_transforms` 为空字符串时保留已有值，避免 Settings.vue 调整背景/透明度/填充模式时覆盖用户在 ReminderFullscreen.vue 中调整的元素位置/缩放/旋转。

### 全屏提醒元素独立编辑（`ReminderFullscreen.vue`）

- 每个元素（标题、正文、倒计时、按钮）可独立调整位置、缩放、旋转。
- 数据存储为 JSON 字符串 `fullscreen_element_transforms`，包含每个元素的 x, y, scale, rotate。
- 交互流程：点击右上角锁图标进入编辑模式 → 点击元素选中 → 拖动改变位置 / 滚轮调整缩放 / 滑块调整旋转 → 点击锁定保存。
- 编辑模式下元素显示虚线边框，选中元素显示紫色边框和编辑工具栏。

---

## 启动事件上报

由 `report.rs` 实现。

- 应用启动时（`lib.rs` setup 阶段）异步上报 `app_start` 事件到 `https://api.upgrade.toolsetlink.com/v1/app/report`。
- 请求头携带 `X-Timestamp`、`X-Nonce`、`X-AccessKey`、`X-Signature`，Body 包含 `eventType`、`appKey`、`timestamp` 与 `eventData`（`launchTime`、`versionCode`、`target`、`arch`、`devKey`）。
- 签名规则：`MD5(body=${body}&nonce=${X-Nonce}&secretKey=${SecretKey}&timestamp=${X-Timestamp}&url=/v1/app/report)`。
- `versionCode` 由应用版本号按 `major * 10000 + minor * 100 + patch` 计算（如 `26.6.18` → `260618`）。
- `target` 做平台映射：`macos` → `darwin`，`windows`/`linux` 保持原值。
- `devKey` 首次启动时生成一个 `dev_${UUID}` 并持久化到 DB，后续启动复用，用于设备级统计。
- 上报失败不影响主流程，仅打印错误日志。

---

## 自动更新检查

由 `lib.rs` + `reminder_toast.rs` + `ReminderToast.vue` 实现。

- 应用启动 3 秒后，Rust 后端通过 `tauri-plugin-updater` 异步检查新版本（携带 `X-AccessKey` 请求头）。
- 若存在可用更新，通过右下角 Toast 窗口弹出橙色更新卡片，标题为「发现新版本 {version}」。
- 卡片提供「查看详情」「立即更新」两个按钮：
  - 「查看详情」展开/收起更新日志（`update.body`）。
  - 「立即更新」调用前端 `check()` 下载并安装，完成后 `relaunch()` 自动重启。
- 更新卡片不会自动关闭，也不参与 8 秒倒计时；下载过程中显示进度条。
- 检查失败仅打印日志，不阻断应用启动；整个生命周期只自动检查一次。

---

## Dashboard 与时间轴

### Dashboard 布局

```
┌──────────┬─────────────────────────────────────┐
│ Catrace  │  今日统计 / 日期                     │
│ 概览     │  ┌────┐ ┌────┐ ┌────┐ ┌────┐       │
│ 设置     │  │活跃│ │休息│ │占比│ │时段│       │
│          │  └────┘ └────┘ └────┘ └────┘       │
│          │  ┌──── 喝水提醒 ────┐               │
│          │  │ 今日次数 · 时间轴 │               │
│          │  └───────────────────┘               │
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
- **喝水提醒**：Dashboard 中的 `WaterWidget` 仅在 `water_reminder_enabled` 为 `true` 时显示；关闭喝水提醒后，对应统计卡片完全隐藏，设置页仍可调整开关与间隔。
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

---

## UI 主题

统一维护在 `src/theme.ts`。

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

---

## 数据库

SQLite，文件保存在 `app_data_dir/catrace.db`。

```sql
-- 每分钟记录
CREATE TABLE records (
    timestamp INTEGER PRIMARY KEY,  -- 整分钟时间戳
    is_active INTEGER,              -- 0 = 休息, 1 = 活跃
    process_name TEXT,              -- 当前焦点窗口进程名
    category TEXT                   -- [已弃用] 原应用分类，现保留列以兼容旧数据
);

-- 喝水记录
CREATE TABLE water_records (
    timestamp INTEGER PRIMARY KEY   -- 秒级时间戳
);

-- 配置键值对
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```
