# Toast 卡片紧凑尺寸规范 & 阴影出血方案

2026-07-11 将 Toast 卡片整体缩小到接近 Windows 11 原生通知的紧凑度；2026-08-27 随小窗化把出血方式从「stack 负 margin」改为「窗口本身就是出血区」。

## 尺寸规范（对标 Win11 原生 toast）

| 项 | 值 | 位置 |
|----|----|------|
| 窗口逻辑宽 | 392px | Rust `TOAST_WINDOW_WIDTH_LOGICAL` / CSS `width: 24.5rem` |
| 卡片宽 | 360px（22.5rem）| `.toast-card { width: 100% }`，左右各 16px 出血 |
| 窗口最小高 | 160px = 卡片 128 + 上下 16 | Rust `TOAST_WINDOW_MIN_HEIGHT_LOGICAL` |
| 卡片最小高 | 128px（`.toast-card min-height: 8rem`）| `CARD_HEIGHT` 常量同步 |
| 卡片 padding | 12px | `.toast-card padding: 0.75rem` |
| root 留白 / 阴影出血 | 16px | `.toast-root padding: 1rem` |
| 卡片间距 | 8px | `.toast-stack gap: 0.5rem` |
| 标题 | 14px / 700 | `.title font-size: 0.875rem` |
| 正文 | 13px / 行高 1.5 | `.body-text font-size: 0.8125rem` |
| 按钮 | 28px 高 / 12px 字 | `.btn height: 1.75rem / font-size: 0.75rem` |
| 计时球 | 84px | `.liquid-ball 5.25rem` |

**常量同步**：Rust `TOAST_WINDOW_WIDTH_LOGICAL` / `TOAST_WINDOW_MIN_HEIGHT_LOGICAL`、CSS `24.5rem` / `8rem`、前端 `reportWindowSize` 里的 `160` 最小高度，改任何一处都要同步。

`EyeToastCard.vue` 是独立组件，尺寸规范同样适用（标题/按钮/间距与通用卡片一致）。

## 小窗化后的出血方式（2026-08-27）

窗口本身即为出血容器：

```css
.toast-root {
  width: 24.5rem;        /* 392px = 360 卡片 + 16×2 出血 */
  padding: 1rem;         /* 16px 四边出血 */
  box-sizing: border-box;
}

.toast-stack {
  padding: 1rem;         /* 与 root 一致，卡片阴影在窗口内完整显示 */
  /* 不再使用负 margin */
}
```

因此 `reportWindowSize` 直接取 `stack.scrollHeight` 即可，不需要再减去 padding；Rust 也按 `TOAST_WINDOW_MIN_HEIGHT_LOGICAL = 160` 作为最小高度。

## 历史：全屏覆盖层的出血（2026-07-11 ~ 2026-08-26）

旧实现中 `.toast-stack` 四边各借 16px padding 放阴影，再用负 margin 拉回，以保证卡片宽度不变：

```css
.toast-stack {
  overflow-y: auto;
  margin: -1rem;
  padding: 1rem;
}
```

副作用：`scrollHeight` 多了 32px，前端 `adjustWindowSize()` 里要手动减掉。小窗化后已废弃，改为上述窗口即出血区方案。

## 阴影本身

双层阴影，比单层更贴近原生观感：

```css
box-shadow:
  0 0.5rem 1.5rem rgba(0, 0, 0, 0.18),   /* 主阴影 */
  0 0.125rem 0.375rem rgba(0, 0, 0, 0.12); /* 贴边层 */
```

主阴影 blur 24px > root padding 16px，边缘会被窗口裁掉一小段，视觉上仍可接受；要继续加深阴影就同步加大 root padding（并更新 Rust 宽度常量）。

## 通用教训

透明无边框窗口里做卡片阴影：**任何带 overflow 的祖先都是裁剪区**，卡片贴边布局下阴影必然被裁。固定套路是「容器加 padding 借出血 + 窗口尺寸包含出血区 + 测量高度时不再额外减 padding」。

