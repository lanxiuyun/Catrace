# 2026-08-01 bt-music 外部插件连接 Toast 与 IsConnected 门控

## Session goal

做目标场景外部插件：蓝牙耳机连接 → Toast → 打开听歌；宿主 **不** 增加蓝牙业务 API，能力全在 sidecar。

## Completed

- 落地 `tools/plugin-demo/bt-music`：manifest + Node sidecar + settings + ui.mjs
- 模拟连接/断开验收 publish → Toast → `open-player` resolved → sidecar spawn
- Windows 可选 PnP 轮询；以 `DEVPKEY_Device_IsConnected` 区分配对与真连接
- 修复：多 Toast/乱码、过滤过死后不弹、未连接假阳性
- settings 去掉未注入的 `NInputNumber`，轮询间隔用 `NInput`
- 文档：plugin-demo README、sidecar 架构表中 bt-music 包状态
- 提交：`8e32f35 feat(plugins): add bt-music external plugin for headset connect toast`（分支 `8-蓝牙连接提醒`）

## Remaining

- M15.3：sidecar storage 往返、Plugins UI sidecar 运行态
- 信任文案补「sidecar = 本机代码」
- 未纳入提交的无关改动：`src-tauri/Cargo.toml`（若仍脏）

## Key file changes

| File | Change |
|------|--------|
| `tools/plugin-demo/bt-music/**` | 新插件包 |
| `tools/plugin-demo/README.md` | bt-music 手测与 IsConnected 说明 |
| `.agent/architecture/desktop-event-os/plugin-native-sidecar-runtime.md` | demo 表标记包已落地 |

## 关键结论（给后续 agent）

- v1 检测 = **轮询 + IsConnected**，不是 BT 事件订阅
- 假阳性第一怀疑：`Status=OK` 当 connected
- 中文设备名：PowerShell → UTF-8 文件，勿直读 stdout
