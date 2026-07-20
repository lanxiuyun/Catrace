# 2026-07-20 rest-timer Bus 收敛与 Debug Signal 展示

## 本轮目标

用户确认：water/eye UI、Toast 无限连点延后；继续 Step2 —— Signal 分钟桶展示 + rest-timer 专用通道收敛。

## 完成

1. **rest-timer → Event Bus**
   - `bus.upsert_by_dedupe_key` + 单测
   - `lib.emit_rest_timer_event` 替换两处 `catrace-rest-timer` emit
   - Toast 统一 `catrace:event` 消费；dismiss/恢复活跃 resolve bus
2. **Debug Signal 分钟桶面板** + zh/en i18n
3. 路线图一句话进度 / `manifest.current` 更新

## 验证

- `cargo test --lib bus::` 7 passed
- `cargo check` ok
- `vue-tsc --noEmit` ok

## 未做 / 延后

- water/eye 插件 UI
- Toast 无限制连点堆叠抗崩
- Signal 真机 ≥2min 验收（需用户跑 dev）
