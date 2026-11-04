# 调试页

媒体检测、行为采集的实时观察台，Event SDK 也挂在这里。侧栏入口「调试」。

## 涉及文件

- `src/app/pages/Debug.tsx` — 页面容器：2 秒轮询、错误态、Toast 调试背景开关
- `src/app/pages/debug/DebugPanel.tsx` — 面板外壳 + 标题右侧事实项 / 控件位
- `src/app/pages/debug/StatusOverview.tsx` — 实时状态（一行四格，标题右侧挂页面开关）
- `src/app/pages/debug/SignalPanel.tsx` — Signal 分钟桶表
- `src/app/pages/debug/AudioPanel.tsx` — 音频会话表
- `src/app/pages/debug/EventSdkCard.tsx` — Event SDK 面板（设置卡结构）
- `src/app/pages/debug/format.ts` — 分钟 / 鼠标位移 / 鼠标槽格式化
- `src/app/pages/debug.css` — 页面全部样式
- `src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts` — `debug.*` 词条

## 页面结构（按阅读顺序）

1. **实时状态**：一行四格——当前状态（活跃/休息，蓝/绿点与概览页同义）、前台应用（hover 看进程路径）、媒体播放（附音频会话数）、本分钟 Signal 快照。标题右侧是「Toast 调试背景」开关
2. **Signal 分钟桶**：最近 12 条；标题右侧显示键序列开关 / 保留时长 / 待落库桶数。表体固定 `max-height: 14rem`（约 5 行）**内部滚动、表头吸顶**——日志类长表不该把整页拉长
3. **音频会话**：输出可用性、播放状态、会话数 + 会话表（进程 / PID / 峰值 / 白名单）
4. **Event SDK**：启用开关 / API 地址 / 访问令牌；全宽面板（不要和音频会话并排——两块信息密度差太多，并排反而两边都显得空）

页名不显示（侧栏已高亮「调试」），`h1` 只留给读屏；**整页不设页头**。

## 视觉约定（面板档）

- **面板**：`--ct-surface` + `1px --ct-border-card` + 圆角 1.25rem + 内边距 1.25rem，**不投阴影**
  - 理由：阴影在这套语言里表达「高度」，只留给真正浮起的表面（Toast、拖拽中的卡、hover 抬升的卡）。宽面板套卡片投影时，软影会填满 1rem 的卡间距，看上去像底下又垫了一层卡（2026-11-04 修掉）
- **面板标题**：1.125rem / 650 / `-0.015em`；标题右侧的小事实 = 12px 标签 + 值（数字 `tabular-nums`）
- **页面级开关**：做成 12px 标签 + Switch 的胶囊，挂在实时状态面板标题右侧（`DebugPanel` 的 `meta` 位），**不要再单独拉一条粘性页头**
- **表格**：11px 表头、13px 单元格、hairline 行线、数字列右对齐 + `tabular-nums`、进程名 14rem 截断（`title` 看全）；长表容器固定高度内部滚动，`border-collapse: separate` + 吸顶 `th`（`collapse` 模式下吸顶表头的边框会跟着滚）
- **Event SDK 行**：行距 `0.75rem 0`、相邻行自动 hairline、行标题 14px/600 + 描述 12px/1.5 —— 与系统设置页的行语言一致，不要另起一套
- 状态色沿用概览页：蓝 = 活跃、绿 = 休息；不要给普通数据加颜色

## 交互与状态

- 轮询 2 秒；失败时保留上次数据，页面顶部 Callout 展开错误原文。**没有手动刷新按钮**——2 秒轮询已经够快，页头因此可以去掉。
- Toast 调试背景：即时保存，开关状态从后端读一次。
- Event SDK：开关即时保存；令牌默认遮蔽，显示/复制/轮换；轮换前 `confirm`。
- 空态：Signal「运行满 1 分钟后，每分钟落一条分钟桶」；音频「没有检测到音频输出」；平台不支持时显示 `audio_error`。

## 设计取舍

- **四张卡合成「实时状态」**：最终判定 / 焦点窗口 / Signal 当前分钟原本是三张独立卡，信息重复且把页面拉得很长；合成一行四格后，一眼能答「它现在在不在工作」。
- **不要页头**：原来的粘性工具条只放「更新于 / 每 2 秒刷新 / 刷新按钮 / Toast 开关」，对常驻观察窗来说占着一条常驻栏却没什么可点的；现在唯一有意义的开关挂到实时状态面板标题右侧，刷新频率写进 Signal 面板的说明（`debug.signal.hint`）。
- **调试页也能挂设置卡**：Event SDK 结构就是设置卡（标题 + 描述 + 右侧控件），行语言沿用设置页，避免同一页冒出第三种行样式。
- **通知测试面板已移除**（2026-11-04）：它只是造一条假通知；需要弹卡时用插件或系统通知转发就够了，调试页不再内置循环。后端 `start_notification_test` / `stop_notification_test` 命令和 `src/api/tauri.ts` 的封装仍保留，以后要接回也有入口。

## 相关

- [[event-sdk]] — 本机 HTTP 事件接口
- [[input-monitoring]] — Signal 分钟桶的采集侧
- [[media-audio]] — 音频会话 / 媒体判定
- [设置页](../settings/README.md) — 行语言与卡片角色对照
