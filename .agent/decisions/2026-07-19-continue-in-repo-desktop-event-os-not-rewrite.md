# 2026-07-19 同仓演进 Desktop Event OS 而非重写

## Context

产品要从休息提醒工具抬到「桌面事件操作系统」，同时加厚行为采集（前台/键鼠）。存在重写冲动。

## Decision

**在现有 Catrace 仓库内抽出 Event Core + Signal Core 模块继续演进，不新开空仓、不整项目重写。**

## Why

- Toast / 窗口焦点 / Agent hook / 跨平台权限等是已付学费的资产
- Event OS 的差异化在协议与分发，不在换壳
- 双仓会复制 Runtime 与踩坑成本

## Consequences

- `lib.rs` 只做组合；逻辑进 `event`/`bus`/`signal`
- 生产者长期双写再收敛，避免 Big Bang 切 Toast
- Agent 通知路线图与 Event OS 路线图并存，agent 是 bus 上的生产者之一

相关：[[desktop-event-os]]
