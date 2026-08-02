# bt-music（蓝牙听歌）

外部插件：蓝牙耳机真正连上后 Toast，可一键打开听歌程序。**无宿主蓝牙/业务 Rust API**；检测与 spawn 全在 sidecar。

## 一句话

启用插件 → Node sidecar 订阅 Windows `Win32_DeviceChangeEvent` → 事件后扫 PnP（`DEVPKEY_Device_IsConnected=True`）→ delta `publish` → Toast → action `open-player` 由 sidecar `spawn`。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/bt-music/manifest.json` | id=`bt-music`，sidecar `node runtime/main.mjs`，events 白名单 |
| `tools/plugin-demo/bt-music/runtime/main.mjs` | 设备变更事件监听 / open-player / Toast 倒计时 / JSONL bridge |
| `tools/plugin-demo/bt-music/settings.mjs` | 三面板：触发设备与监听 / 听歌程序与自动化 / 通知偏好 |
| `tools/plugin-demo/bt-music/ui.mjs` | CONNECTED / DISCONNECTED Toast 卡 |
| `tools/plugin-demo/README.md` | demo 索引与手测步骤 |

Debug 构建 junction：`tools/plugin-demo/bt-music` → `app_data/plugins/bt-music`。

## 子文档

- [windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md](windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md) — 检测真源、事件驱动、假阳性/假阴性与编码坑

## 关键约定

- **宿主不加蓝牙 API**；能力边界见 [[plugin-native-sidecar-runtime]]。
- Settings 只用宿主注入的 naive 组件（`NInput`/`NSwitch`/`NSelect`/`NTag`/`NButton`，**无** `NInputNumber`）。
- **Settings 产品文案**：不暴露 sidecar / PnP / DEVPKEY / payload。面板：1 触发设备与监听、2 听歌程序与自动化、3 通知偏好（连接/断开驻留左右两栏）。
- **多关键词**：`nameKeywords: string[]`（任一匹配）；legacy `nameFilter` 读入时迁成单关键词。可从 `listPairedDevices` 快速点选。
- **自动化**：`autoLaunchOnConnect`（连接后立即启动）；`pauseOnDisconnect`（断开发媒体 Play/Pause 键）。
- **监听总闸**：`listenEnabled`（关则不 publish / 不自动动作；sidecar 仍可跑）。
- **启用即系统事件监听**：无轮询间隔；PowerShell `ManagementEventWatcher`。
- 首轮成功快照只 seed；Toast 默认连接 5s / 断开 3s；听歌程序默认空。
- Settings 改动 debounce 后 `config.set` + `setConfig`。

## 相关

- [[desktop-event-os]] / [[plugin-native-sidecar-runtime]] — sidecar 协议与 demo 里程碑
- [[timer-plugin]] — 另一外部插件参考（settings 布局 / naive 注入）
- [[toast-window]] — sticky / action resolved 回传 / auto_hide_ms
- [[plugin-center]] — 启用与详情面板
