# 2026-07-18 — 审批卡鼠标移出即消失

> 关联：[[agent-notification]] P6 真审批；同 session 销项模型见 [permission-挂起时-session变化必须-timeout释放-与-HTTP请求并行](../features/agent-notification/permission-挂起时-session变化必须-timeout释放-与-HTTP请求并行.md)。

## 症状

测试页发 `/permission` 弹出琥珀色审批卡后，**鼠标移入卡片再移出，卡片直接消失**。

## 根因

`ReminderToast.vue` 的 `handleMouseLeave` 对**所有非 sticky、非 eye/rest-timer 的卡片**生效：

```ts
function handleMouseLeave(item: ToastItem) {
  if (item.kind === 'eye' || item.kind === 'rest-timer' || item.sticky) return
  item.isHovered = false
  if (item.remainingMs > 0) {
    startTimer(item)
  } else if (item.kind !== 'update') {
    removeNotification(item.id, true)   // ← permission 卡 remainingMs = 0，走到这里被关
  }
}
```

审批卡是**常驻卡**（`remainingMs = 0`），但 push 时**没有标 `sticky: true`**，导致 hover 离开时命中 `removeNotification`，被当成普通自动隐藏卡关闭。

## 修复

`handleMouseEnter` / `handleMouseLeave` 的豁免条件里显式加入 `item.kind === 'permission'`：

```ts
if (item.kind === 'eye' || item.kind === 'rest-timer' || item.kind === 'permission' || item.sticky) return
```

## 为什么不是 sticky

P6 设计里 permission 卡「常驻直到用户决策，不参与自动隐藏与 sticky 合并」，所以没给 `sticky: true`。这次把 hover 路径也一并豁免，语义更完整。

## 验证

- `pnpm vue-tsc --noEmit` ✅
- 真机：测试页发审批 → 鼠标移入/移出 → 卡片保持，点 Allow/Deny/前往终端才关闭 ✅
