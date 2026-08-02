# Toast 自动隐藏进度条：CSS 动画 + hover 暂停（勿双计时器）

插件/内置卡底部细条表示距自动关闭还剩多久。必须与宿主 **同一套** 关闭定时器对齐。

## 正确做法（Rest / Sdk / bt-music）

1. 宿主 `startTimer`：`setTimeout(close, remainingMs)`，并设 CSS 变量  
   `--toast-auto-hide-ms: ${totalMs}ms`（**全长**，不要每次 resume 改成剩余）。
2. 卡片：

```css
.bar {
  animation: shrink var(--toast-auto-hide-ms, 8000ms) linear forwards;
  transform-origin: left center;
}
.bar.paused { animation-play-state: paused; }
```

3. hover：`isHovered=true` → 宿主 `stopTimer`（扣减 elapsed 写入 `remainingMs`）+ 卡 `.paused`。  
4. leave：宿主 `startTimer`（用剩余 `remainingMs` 设新 timeout）+ 去掉 pause。  
   **CSS 时间线在 pause 期间冻结**，resume 从当前宽度继续，不会重头。

## 禁止

| 错误 | 后果 |
|------|------|
| 卡内再跑 rAF/`setInterval` 倒计时 | 与宿主不同步，hover 后条变长/乱跳 |
| 用 `remaining/total` 静态 scaleX 且宿主运行中不刷新 remaining | 条完全不动（宿主只在 stop 时写 remaining） |
| `startTimer` 里 `totalMs = remainingMs` | resume 后 `--toast-auto-hide-ms` 变短，条与关闭时刻错位 |
| hover 后用「剩余时长」重启动画却从 scaleX(1) 开始 | 条瞬间拉满再缩 |

宿主约定（`ReminderToast.startTimer`）：

```ts
// 保留首次 totalMs；只缩 remainingMs
if (!(item.totalMs > 0)) item.totalMs = item.remainingMs
```

## 插件卡 props

宿主经 `PluginHostCard` 可传 `isHovered` / `remainingMs` / `totalMs`。  
**进度展示优先只依赖 `isHovered` + CSS 变量**；remaining/total 给需要数值的场景，不要单独驱动第二套时钟。

## 相关

- [[bt-music]] 紧凑卡
- [外部插件toast卡热更新-…](外部插件toast卡热更新-generation缓存与reload顺序.md)
