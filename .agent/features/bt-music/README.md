# bt-music（蓝牙听歌）

外部插件：蓝牙耳机真正连上后 Toast，可一键打开听歌程序。**无宿主蓝牙/业务 Rust API**；检测与 spawn 全在 sidecar。

## 一句话

启用插件 → Node sidecar 订阅 Windows `Win32_DeviceChangeEvent` → 事件后扫 PnP（`DEVPKEY_Device_IsConnected=True`）→ delta `publish` → Toast → action `open-player` 由 sidecar `spawn`。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/bt-music/manifest.json` | id=`bt-music`，sidecar `node runtime/main.mjs`，events 白名单 |
| `tools/plugin-demo/bt-music/runtime/main.mjs` | 设备变更事件监听 / open-player / Toast 倒计时 / JSONL bridge |
| `tools/plugin-demo/bt-music/settings.mjs` | 产品向三段：触发条件 / 听歌程序 / 弹窗偏好；自动保存 |
| `tools/plugin-demo/bt-music/ui.mjs` | CONNECTED / DISCONNECTED Toast 卡 |
| `tools/plugin-demo/README.md` | demo 索引与手测步骤 |

Debug 构建 junction：`tools/plugin-demo/bt-music` → `app_data/plugins/bt-music`。

## 子文档

- [windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md](windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md) — 检测真源、事件驱动、假阳性/假阴性与编码坑

## 关键约定

- **宿主不加蓝牙 API**；能力边界见 [[plugin-native-sidecar-runtime]]。
- Settings 只用宿主注入的 naive 组件（`NInput`/`NSwitch`/`NButton`，**无** `NInputNumber`）。
- **Settings 产品文案**：不暴露 sidecar / PnP / DEVPKEY / payload / 轮询 / 读状态 JSON。三段：触发条件、听歌程序、弹窗偏好。调试能力（`refresh`/`getStatus`）仅 RPC，不进 UI。
- **启用即监听**：无 `watchEnabled` / 无轮询间隔；sidecar 启动即 long-lived PowerShell `ManagementEventWatcher`（到达/移除）。
- 首轮成功快照只 seed，不 publish；之后才对 delta 发连接/断开。事件突发在 PS 侧 ~700ms、Node 侧 ~350ms 合并。
- Settings **无「保存并同步」**：改动 debounce 后 `plugin.config.set` + `setConfig` RPC。
- Toast 倒计时默认连接 5s / 断开 3s；`connectedAutoHideSec` / `disconnectedAutoHideSec`（0=sticky；≥3 → `sticky:false` + `payload.auto_hide_ms`）。宿主钳制 3s–10min。
- 听歌程序默认空；未配置时 open-player 返回友好错误，不再默认 notepad。
- Toast 仍是可见权威；sidecar `publish` 走 Event Bus。
- 无模拟连接 UI/RPC。

## 相关

- [[desktop-event-os]] / [[plugin-native-sidecar-runtime]] — sidecar 协议与 demo 里程碑
- [[timer-plugin]] — 另一外部插件参考（settings 布局 / naive 注入）
- [[toast-window]] — sticky / action resolved 回传 / auto_hide_ms
- [[plugin-center]] — 启用与详情面板
