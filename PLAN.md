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
| `silent_start` | 开机自启时不显示主窗口 | false |
| `locale` | 界面语言（zh-CN / en-US） | 自动检测系统语言，回退 zh-CN |


## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3 + TypeScript + Vite + naive-ui |
| 后端(Rust) | rdev + device_query + rusqlite + tokio + active-win-pos-rs |
| 时间轴 | **CSS Grid（24×60 色块），非 ECharts/SVG** |
| 主题 | `src/theme.ts`（色板 + naive-ui themeOverrides） |

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
├── i18n/
│   ├── index.ts             -- vue-i18n 配置（zh-CN / en-US）
│   └── locales/
│       ├── zh-CN.ts         -- 中文翻译
│       └── en-US.ts         -- 英文翻译
├── views/
│   ├── Dashboard.vue        -- 四统计卡片 + 今日活动（概览/详细切换）
│   └── Settings.vue         -- 两栏布局：提醒偏好 + 提醒设置（模式/全屏背景/内容/测试）+ 系统 + 链接
├── components/
│   ├── Timeline.vue         -- 24h × 60min 色块热力图（CSS Grid）
│   └── TimelineWindows.vue  -- 概览 block 卡片网格（可展开整行分钟色块）
├── utils/
│   └── timeBlocks.ts        -- block 切分算法（与 Dashboard 统计共用）
├── router/
│   └── index.ts             -- hash 路由
├── api/
│   └── tauri.ts             -- invoke 调用 Rust 命令的封装
├── theme.ts                 -- 统一色板 + naive-ui 主题覆盖
├── App.vue                  -- 侧边栏布局 + 主题注入 + naive-ui locale + 滚动容器
└── main.ts                  -- Vue 入口
```

### Dashboard 页面结构

1. **页头**：标题「今日概览」+ 日期（无实时状态标签）
2. **统计区**（4 列 grid，等高白卡片）：
   - 活跃分钟、休息分钟、活跃占比、活跃时段数
   - 彩色圆点区分类型，数值按活跃/休息/默认着色
3. **今日活动**（全宽白卡片）：
   - 右上角「概览 / 详细」切换，**默认概览**
   - 概览 → `TimelineWindows.vue`；详细 → `Timeline.vue`

> **已移除的 UI 元素**（2025-05 UI 重构）：右侧「活跃 vs 休息」环形图、页头「活跃中/休息中」标签、概览条目内的全宽色条与多层卡片嵌套。

### 视图实现说明

**详细视图**（`Timeline.vue`，切换后展示）：
- **技术**：CSS Grid（24 行 × 60 列），每个 `<div>` 色块代表 1 分钟。
- **布局**：行 = 小时（00-23），列 = 分钟（0-59）。
- **交互**：鼠标在网格上移动，通过坐标计算对应分钟索引，显示时间与状态。
- **当前时间**：对应色块加红色边框/脉冲高亮。
- **图例**：活跃（紫）、休息（绿）、无记录（灰）、当前时间（红框）。

**概览视图**（`TimelineWindows.vue`，默认展示）：
- 基于 `utils/timeBlocks.ts` 前瞻式 block 切分，将全天切分为活跃 / 休息 block。
- 连续休息 block 自动合并，活跃 block 保持独立。
- **卡片网格**：CSS Grid `repeat(auto-fit, minmax(15.625rem, 1fr))`，列数随容器自适应，卡片最小 250px 并自动拉伸填满整行。每张卡片显示色点 + 时间范围 + 时长 + 状态标签。
- 当前 block：淡紫背景 + 「进行中」标签。
- **整行展开**：点击任意卡片，同行全部卡片同步展开/收起。展开内容：每 10 分钟一行的迷你色块 + 时间标签。

### UI 主题与布局

| 项目 | 说明 |
|------|------|
| 背景色 | `#F7F5FA`（淡紫灰） |
| 卡片 | 白底、`#EBE6F2` 边框、轻阴影、`border-radius: 12px` |
| 活跃色 | `#7C3AED` / `#6D28D9` |
| 休息色 | `#059669` |
| 主题注入 | `App.vue` → `NConfigProvider :theme-overrides="themeOverrides"` |
| 滚动策略 | `html/body` 禁止滚动；`n-layout-content` 仅在内容溢出时滚动；页面不用 `min-height: 100vh` |

设计原则：干净克制，颜色用于信息区分而非大面积装饰。

## 开发计划

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
| 9 | Dashboard UI 精简重构（主题统一、去冗余面板、紧凑列表、滚动修复） | ✅ |
| 10 | 概览视图整行展开：点击卡片同步展开/收起同行全部卡片 | ✅ |
| 11 | 设置页文本优化 + 开机自启/静默启动开关 | ✅ |
| 12 | 关闭不退出最小化到托盘，双击托盘显示主页面 | ✅ |
| 13 | 设置页两栏布局 + 相关链接（GitHub/更新日志/问题反馈） | ✅ |
| 14 | 国际化 i18n：vue-i18n 前端 + Rust 后端通知/托盘本地化，支持 zh-CN / en-US | ✅ |
| 15 | 设置页语言切换器，默认自动检测系统语言 | ✅ |
| 16 | 设置页重构：拆分为「提醒偏好」与「提醒设置」两个独立卡片 | ✅ |
| 17 | 提醒模式切换（系统通知 / 弹窗提醒 / 全屏提醒），全屏背景图与透明度设置仅全屏模式下显示 | ✅ |
| 18 | 全屏背景图上传 UI 重设计：预览卡片 + 毛玻璃操作按钮 + 虚线拖拽区域 | ✅ |

## 构建命令

```bash
# 前端开发（不启动 Tauri）
pnpm dev

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
- **未来 null 不参与切分**：`computeTimeBlocks` 将全天数据截断到 `nowIdx + 1` 后再切分。若不排除未来 null，`findBreakEnd` 会把尚未发生的无记录分钟当作「连续休息」，切出一个从当前时间直通午夜的超大休息 block，既污染统计数据，也让 UI 出现幽灵时段。

## 近期 UI 变更摘要（2025-05）

以下为 Dashboard 界面迭代最终态，供后续开发参考：

1. **移除环形图面板**：「活跃 vs 休息」与顶部统计重复，今日活动改为全宽展示。
2. **移除页头状态标签**：「活跃中 / 休息中 / 未记录」标签已去掉。
3. **概览列表紧凑化**：由双行卡片（时间 + 全宽色条）改为单行列表（时间 · 时长 · 标签），可点击展开分钟色块。
4. **新增 `src/theme.ts`**：集中管理色板与 naive-ui 组件主题，侧边栏菜单、Radio、Button 等统一紫色调。
5. **统计卡片重写**：弃用 `NStatistic` + 渐变满色底，改为四张等高自定义白卡片。
6. **修复多余滚动条**：去掉页面 `min-height: 100vh`，根节点 `overflow: hidden`，滚动仅发生在主内容区。
7. **概览视图整行展开**：由单卡片展开改为点击卡片同步展开/收起 CSS Grid 同行全部卡片，保持行高一致。
