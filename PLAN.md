# Catrace 开发计划

## 项目概述

后台静默运行的桌面应用，监听用户键鼠活动，判断工作/休息状态，连续工作时间过长时提醒休息。

## 核心逻辑

1. **采样**：每 2 秒检查光标位置；全局监听键盘按下事件（触发后 2s 内去重）
2. **分钟判定**：60 秒内活动次数 ≥ 3，则该分钟标记为 **活跃**，否则为 **休息**
3. **Block 切分与提醒**：从首个记录开始向后以 `window_minutes` 为单元切分 block
   - 窗口内存在连续 `break_minutes` 分钟休息 → 切为休息 block（到连续休息结束）
   - 窗口内无足够连续休息 → 切为活跃 block（固定 `window_minutes` 长度）
   - 当前时间所在为未完结的「进行中 block」
   - 提醒逻辑：
     - 前一个已完成 block 为活跃 → 提醒（刚干完一波）
     - 前一个已完成 block 为休息，当前进行中 block 长度 ≥ `window_minutes` → 提醒（休息后又工作满一波）
     - 其余情况不提醒
   - `lib.rs` 维护 `last_notify_boundary` 去重，同一 block 边界只提醒一次

## 配置项

| 配置名 | 说明 | 默认 |
|--------|------|------|
| `window_minutes` | 工作窗口长度（分钟） | 45 |
| `break_minutes` | 连续休息多少分钟算断开（分钟） | 5 |


## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3 + TypeScript + Vite + naive-ui |
| 后端(Rust) | rdev + device_query + rusqlite + tokio + active-win-pos-rs |
| 时间轴 | **CSS Grid（24×60 色块），非 ECharts/SVG** |

## 数据库设计

```sql
-- 每分钟记录
CREATE TABLE records (
    timestamp INTEGER PRIMARY KEY,  -- 整分钟时间戳
    is_active INTEGER,              -- 0 = 休息, 1 = 活跃
    process_name TEXT,              -- 当前焦点窗口进程名
    category TEXT                   -- [已弃用] 原应用分类，保留列兼容旧数据
);

-- 配置键值对
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

## Rust 模块结构（实际）

```
src-tauri/src/
├── main.rs    -- Tauri 入口，调用 lib::run()
├── lib.rs     -- 全部业务逻辑（采样、结算、通知、命令、托盘）
└── db.rs      -- rusqlite 读写封装 + 单元测试
```

> 原计划拆分为 `input/`、`engine/`、`notify.rs`、`commands.rs` 等子模块，实际落地时为了快速验证全部集中在 `lib.rs`。后续如需扩展可再拆分。

## 前端结构

```
src/
├── views/
│   ├── Dashboard.vue    -- 今日统计 + 24h 时间轴
│   └── Settings.vue     -- 滑块 + 应用分类编辑
├── components/
│   └── Timeline.vue     -- 24h × 60min 色块热力图（CSS Grid）
├── router/
│   └── index.ts         -- hash 路由
├── api/
│   └── tauri.ts         -- invoke 调用 Rust 命令的封装
├── App.vue              -- naive-ui 布局 + 侧边栏
└── main.ts              -- Vue 入口
```

### 视图实现说明

**详细视图**（`Timeline.vue`，默认不展示）：
- **技术**：CSS Grid（24 行 × 60 列），每个 `<div>` 色块代表 1 分钟。
- **布局**：行 = 小时（00-23），列 = 分钟（0-59）。左侧显示小时标签，顶部显示分钟刻度（0/15/30/45）。
- **交互**：鼠标在网格上移动，通过坐标计算对应分钟索引，显示时间与状态。
- **当前时间**：对应色块加红色边框高亮。
- **图例**：活跃（绿）、休息（蓝）、无记录（灰）、当前时间（红框）。

**概览视图**（`TimelineWindows.vue`，默认展示）：
- 基于前瞻式 block 切分算法，将全天切分为活跃 block 和休息 block。
- 从首个记录开始向后扫描：窗口内遇连续 `break_minutes` 休息 → 休息 block；否则 → 活跃 block（固定 `window_minutes` 长度）。
- 连续休息 block 自动合并，活跃 block 保持独立。
- 点击 block 展开显示每 10 分钟的迷你色块 + 时间标签。
- 当前时间所在 block 标记为「进行中」。

## 开发计划（8 步）

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | Rust 裸跑：rdev 键盘监听 + 2s 光标采样 | ✅ |
| 2 | 加每分钟活跃判定，写入 SQLite | ✅ |
| 3 | Block 切分与提醒算法 + 系统通知 | ✅ |
| 4 | Tauri 套壳，前端 Vue 3 + 路由搭建 | ✅ |
| 5 | 前端 Settings 页：滑块改配置 | ✅ |
| 6 | 前端 Dashboard：今日活动（详细/概览双视图，默认概览）+ 今日统计 | ✅ |
| 7 | 系统托盘图标 | ✅ |
| 8 | ~~应用分类名单~~ | ❌ 已砍掉 |

## 构建命令

```bash
# Tauri 开发模式
pnpm tauri dev

# 构建发布版
pnpm tauri build

# Rust 测试
cd src-tauri && cargo test
```

## 边界情况

- 浏览器无法区分标签页，整个浏览器进程归用户设定的一类
- 监听线程崩溃应自动重启，前端显示状态
- 通知基于 block 切分逻辑触发：活跃 block 完成后提醒一次，休息后又工作满一个窗口再提醒一次
- `lib.rs` 维护 `last_notify_boundary` 去重，避免同一 block 边界连续每分钟轰炸
