# Catrace — Agent Guide

> 本文档面向 AI 编程助手。

---

## 项目概述

Catrace 是一款桌面端工具，帮助用户平衡工作与休息。

- **核心功能**：后台静默监听键鼠活动，判断用户是否处于连续工作状态；当连续活跃时间超过阈值时，通过系统通知提醒用户休息。
- **隐私承诺**：不偷拍屏幕、不上传数据，所有信息保存在用户本地。
- **当前状态**：**已实现核心功能**，前端 Dashboard 可查看 24h 时间轴与统计，Rust 后端已完成采样、判定、通知、数据库全流程。

---

## 仓库现状

```
.
├── README.md
├── PLAN.md
├── AGENTS.md
├── package.json          # pnpm + Vite + Vue 3
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/                  # Vue 3 前端
│   ├── api/tauri.ts
│   ├── assets/
│   ├── components/
│   │   └── Timeline.vue  # 24h 分钟级色块热力图（CSS Grid）
│   ├── router/index.ts
│   ├── views/
│   │   ├── Dashboard.vue
│   │   └── Settings.vue
│   ├── App.vue
│   ├── main.ts
│   └── vite-env.d.ts
├── src-tauri/            # Tauri 2 + Rust
│   ├── src/
│   │   ├── main.rs       # 入口，调用 lib::run()
│   │   ├── lib.rs        # 全部业务逻辑（采样、结算、通知、命令）
│   │   └── db.rs         # rusqlite 封装
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── ...
└── public/
```

> **注意**：Rust 侧未按 PLAN.md 的分层目录（`input/`、`engine/` 等）实现，而是将所有逻辑集中在 `lib.rs` 中，通过模块级函数组织。

---

## 已落地的技术栈

| 层级 | 选型 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3 + TypeScript + Vite + naive-ui |
| 图表 | **未使用 ECharts**（时间轴用 CSS Grid 实现） |
| 后端（Rust）| rdev（键盘）、device_query（鼠标）、rusqlite（DB）、tokio、active-win-pos-rs（焦点窗口） |

---

## 核心逻辑（已实现）

1. **采样**（`lib.rs`）
   - 每 2 秒检查鼠标光标位置（`device_query`）。
   - 全局监听键盘按下事件（`rdev`），2 秒内去重。
2. **分钟判定**（`lib.rs`）
   - 60 秒内活动次数 ≥ 3 → 该分钟标记为**活跃**；否则标记为**休息**。
3. **连续 block 提醒**（`db.rs` + `lib.rs`）
   - 每分钟结算时，从当前时间往前找**当前连续 block**（时间戳连续且状态相同）。
   - 若当前 block 为**活跃**且长度达到 `window_minutes` → 弹出提醒。
   - 若当前 block 为**休息** → 不提醒。

---

## 配置项

| 配置名 | 说明 | 默认值 |
|--------|------|--------|
| `window_minutes` | 工作窗口长度（分钟） | 45 |
| `break_minutes` | 连续休息多少分钟算断开（分钟） | 5 |


---

## 实际目录结构

### Rust 后端（Tauri 侧）

```
src-tauri/src/
├── main.rs    -- Tauri 入口，仅调用 lib::run()
├── lib.rs     -- 全部业务逻辑：
│                · 键盘/鼠标采样线程
│                · 每分钟结算 + 写入 DB
│                · 滑动窗口检测 + 通知
│                · #[tauri::command] 暴露给前端
│                · 系统托盘
└── db.rs      -- rusqlite 读写封装 + 单元测试
```

> 与 PLAN.md 的差异：原计划拆分为 `input/`、`engine/`、`notify.rs`、`commands.rs` 等模块，实际为了快速落地全部集中在 `lib.rs`。后续如需扩展可再拆分。

### 前端（Vue 3）

```
src/
├── views/
│   ├── Dashboard.vue    -- 今日统计 + 24h 时间轴
│   └── Settings.vue     -- window_minutes / break_minutes 滑块 + 应用分类编辑
├── components/
│   └── Timeline.vue     -- 24h × 60min 色块热力图（CSS Grid，类 GitHub 贡献图）
├── router/
│   └── index.ts         -- hash 路由（/dashboard, /settings）
├── api/
│   └── tauri.ts         -- invoke 调用 Rust 命令的封装
├── App.vue              -- naive-ui 布局 + 侧边栏
└── main.ts              -- Vue 入口
```

### 时间轴实现说明

**网格视图**（`Timeline.vue`）：
- **技术**：CSS Grid（24 行 × 60 列），每个 `<div>` 色块代表 1 分钟，不是 SVG / Canvas / ECharts。
- **布局**：行 = 小时（00-23），列 = 分钟（0-59）。
- **交互**：鼠标在网格上移动，通过坐标计算对应分钟索引，显示时间与状态。
- **当前时间**：对应色块加红色脉冲动画高亮。

**时段视图**（`TimelineWindows.vue`）：
- 基于滑动窗口算法，将全天切分为**活跃 block** 和 **休息 block**。
- 连续休息 block 自动合并，活跃 block 保持独立。
- 点击 block 展开显示每 10 分钟的迷你色块 + 时间标签。
- 当前时间所在 block 标记为「进行中」。

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

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | Rust 采样：rdev 键盘 + device_query 鼠标 | ✅ |
| 2 | 每分钟活跃判定，写入 SQLite | ✅ |
| 3 | 滑动窗口算法 + 系统通知 | ✅ |
| 4 | Tauri 套壳 + Vue 3 前端 | ✅ |
| 5 | Settings 页：滑块改配置 | ✅ |
| 6 | Dashboard：24h 时间轴 + 统计 | ✅ |
| 7 | 系统托盘图标 | ✅ |
| 8 | 应用分类名单（category 已存入 DB，前端 Settings 已支持编辑） | ✅（基础） |
| 9 | Dashboard UI 重设计（lavender wellness 主题 + 统计卡片 + 环形图） | ✅ |
| 10 | 时段视图：滑动窗口 block 列表（网格/时段双视图切换） | ✅ |

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

## 代码风格与约定

- 项目文档与计划全部使用**中文**撰写，代码注释保持一致。
- 前端使用 **Vue 3 Composition API + `<script setup>` + TypeScript**。
- Rust 当前未按功能拆分子模块（全部在 `lib.rs`），后续扩展时建议拆分。

---

## 测试策略

- **Rust**：`db.rs` 包含单元测试（`check_should_notify` 三种场景）。建议补充滑动窗口算法、分钟判定逻辑的独立测试。
- **前端**：目前无自动化测试，依赖手动验证（`pnpm tauri dev` 观察界面）。

---

## 安全与隐私

- 全局键鼠监听仅计数，不记录按键内容或鼠标轨迹坐标。
- 数据库文件保存在 `app_data_dir/catrace.db`，不上传。
- `rdev` 与 `active-win-pos-rs` 需要系统权限（macOS Accessibility / Windows UI Access）。

---

## 对 AI 助手的提示

1. **代码已存在**：项目已完整初始化（Tauri / Vue / Vite / naive-ui），无需再执行框架初始化命令。
2. **优先读代码再改**：Rust 逻辑集中在 `src-tauri/src/lib.rs`，前端逻辑在 `src/views/` 和 `src/components/`。
3. **保持中文文档**：README、PLAN、AGENTS 均为中文，新增文档继续使用中文。
4. **Timeline 实现方式**：网格视图使用 CSS Grid（24×60 的 `<div>` 网格），不是 SVG / Canvas / ECharts；时段视图使用 block 列表 + 迷你色块网格。
6. **UI 主题**：Dashboard 使用 lavender + green wellness 配色（`#FAF5FF` 背景、`#8B5CF6` 活跃、`#10B981` 休息）。
5. **应用分类已砍掉**：不再维护 `app_categories` 配置和 `category` 字段。
