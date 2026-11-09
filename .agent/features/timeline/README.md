# 时间轴

Dashboard 下方活动可视化，支持概览和详细两种视图。

## 涉及文件

- `src/app/pages/dashboard/TimelineWindows.tsx` — 概览视图卡片
- `src/app/pages/dashboard/TimelineGrid.tsx` — 详细视图热力图
- `src/utils/timeBlocks.ts` — `computeTimeBlocks` / `mergeRestBlocks`

## 概览视图（TimelineWindows，默认）

基于 block 切分的卡片网格 `repeat(auto-fit, minmax(15.625rem, 1fr))`。

每张卡片自上而下：**状态胶囊**（内含状态色点，蓝=活跃 / 绿=休息 / 灰=无记录）→ **时间范围** → **时长**（休息 block 右下角再补「活跃 Xm」）。当前 block 用蓝色淡渐变 + 蓝边 + 脉冲圆点 + 「进行中」标签，并带一个朝右的 chevron；展开时 chevron 转 180°。

> 卡片上曾有一条 0–24h 位置条（表示这段落在一天里的位置和长度）。因为没有刻度和提示、读起来像装饰线，已按需求移除，别再往卡片里加同类无标注的图表。

**时间范围**：已完成 block 结束用 `endTs + 60` 不含边界，对齐时长。时长 = 记录条数。

**交互**：卡片外壳是普通 div，真正可聚焦的是盖住整张卡的 `<button class="card-summary">`（内边距挂在这个按钮上，所以「点卡片任何地方」都能展开；原生 Enter / Space 展开，带 `aria-expanded` + `aria-controls`）；展开的明细则放在按钮外面——放进 button 里会被 ARIA 按 presentational 处理，读屏会把整串分钟念成按钮名。hover 抬升 + 加强阴影，按下缩到 `scale(0.994)` 立刻反馈（用 `:has()` 只跟摘要按钮走，明细区不响应按压），`focus-visible` 是 2px 系统蓝 outline（10% 透明度的 box-shadow 环在高对比度模式下会消失）。按钮上要显式 `gap: 0`：Chromium 会把 `appearance: none` 的按钮排成 inline-flex 并自带 `gap`，不清掉的话摘要的几行之间会多出间距。

**展开态 key**：记为 `block.startTs` 而不是数组下标——block 列表会在头部插入新段，用下标会让展开状态串到别的卡上。展开/收起用 `grid-template-rows: 0fr ↔ 1fr` 过渡（**不要换回 max-height**：大值会让过渡前 90% 的时间看不见变化）。展开过的卡片会把明细节点留在 `mounted` 集合里，收起时才有内容可收回，否则折叠是瞬间消失。

**展开视图**：点击卡片整行同步展开。每 10 分钟一行的混合分钟条：
- 连续 ≥5 分钟 → 连续色条（flex 比例宽度）
- <5 分钟 → 独立 8×8px 方块
- hover 上浮 + 高亮，自定义 tooltip（`position: fixed` 挂到 body，不会被卡片圆角裁切）
- 末行不足 10 分钟宽度按实际占比

**减弱动效**：`prefers-reduced-motion: reduce` 下去掉卡片位移和圆点循环动画（chevron 仍翻转，但改成瞬间），展开只保留 opacity 过渡、高度瞬变；分段控件的滑块也缩成瞬切。

## 详细视图（TimelineGrid）

CSS Grid（24 行 × 60 列），每格 1 分钟 `<div>` 色块，正方形的格子决定整张热力图高度（宽的一侧约等于宽的 0.4 倍）。

- **颜色语义和概览卡同一套**：活跃 `--ct-accent` / 休息 `--ct-success` / 无记录 `--ct-surface-2`（中性灰，不再是淡蓝）。当前分钟是**系统蓝细环 + 呼吸**，不用红色（红色留给错误语义）。
- **悬停是纯 CSS 的**：`.cell:hover` 用 1px `outline` 描边，不经过 React、不改 z-index、不加过渡。底部读数靠 `mousemove` 算格子索引更新，并且同一格不重复 setState。热力图只读，不做点击/选中。
- **底部一行**：左侧是时间 + 状态胶囊（软底 + 语义色文字，和无记录的白底白字问题已修掉），右侧是图例（方形色点对应格子形状，当前分钟画成圆环点）。
- **小时标签每 3 小时一个**（00/03/…/21）：24 行网格每行只有 7–8px，逐小时标会叠在一起；分钟刻度 0/15/30/45 标在顶部表示「每小时内的第几分钟」。
- **性能约定（踩过坑，别改回去）**：1440 个格子整体包在 `Cells`（`memo`）里，只依赖分钟数据；悬停不重渲染它们。当前分钟是一个独立的绝对定位覆盖环（`.now-ring`），只做 `transform` / `opacity` 的合成层动画，**不要**用 `box-shadow` 关键帧（那会每帧重绘整张网格）。此前正是「每次 mousemove 重渲染 1440 个格子 + 每帧重绘网格」把主线程占满，输入事件排队，表现为点几下之后 hover/点击卡死十几秒、但画面还在动。
- `prefers-reduced-motion` 下关掉当前分钟覆盖环的呼吸动画。

色值走主题 token（见 `.agent/architecture/theme`）。
