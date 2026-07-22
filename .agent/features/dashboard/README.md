# Dashboard

主页面，展示今日统计和活动时间轴。

## 涉及文件

- `src/views/Dashboard.vue` — 页面布局
- `src/components/Timeline.vue` — 详细视图热力图
- `src/components/TimelineWindows.vue` — 概览视图 block 卡片
- `src/components/WaterWidget.vue` — 喝水统计
- `src/utils/timeBlocks.ts` — 前端 block 切分算法

## 布局

```
┌───────────────────────────────────────────────┐
│ 顶部导航：Catrace / 概览 / 功能插件 / 调试 / 设置 │
├───────────────────────────────────────────────┤
│ 今日统计 / 日期                                │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                  │
│ │活跃│ │休息│ │占比│ │时段│                  │
│ └────┘ └────┘ └────┘ └────┘                  │
│ 喝水提醒 / 今日活动（概览｜详细）               │
└───────────────────────────────────────────────┘
```

## 统计卡片

四张白卡片（非 `NStatistic`），彩色圆点 + 按类型着色数值。响应式：宽屏 4 列 / 中等 2 列 / 窄屏 1 列。

- **活跃**：block 语义计算——活跃 block 全部时长 + 休息 block 里的活跃分钟
- **休息**：休息 block 里实际休息的分钟
- **活跃占比**、**活跃时段**：基于 block 语义

## 滚动

普通页面由 `App.vue` 的 `OverlayScrollbar` 负责滚动。Dashboard 根节点不要自行创建同方向滚动，也不要使用 `min-height: 100vh`。详见 [[app-shell]]。

## 时间轴双视图

- **概览**（默认）：block 卡片网格 `repeat(auto-fit, minmax(15.625rem, 1fr))`，点击整行展开
- **详细**：24h×60min CSS Grid 热力图，当前分钟红色脉冲高亮

详见 [[timeline]]。
