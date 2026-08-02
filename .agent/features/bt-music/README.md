# bt-music（蓝牙听歌）

外部插件：蓝牙耳机真正连上后 Toast，可一键打开听歌程序。**无宿主蓝牙/业务 Rust API**；检测与 spawn 全在 sidecar。

## 一句话

启用插件 → Node sidecar 订阅 Windows `Win32_DeviceChangeEvent` → 事件后扫 PnP（`DEVPKEY_Device_IsConnected=True`）→ delta `publish` → Toast → action `open-player` 由 sidecar `spawn`。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/bt-music/manifest.json` | id=`bt-music`，sidecar `node runtime/main.mjs`，events 白名单 |
| `tools/plugin-demo/bt-music/runtime/main.mjs` | 设备变更事件监听 / open-player / Toast 倒计时 / JSONL bridge |
| `tools/plugin-demo/bt-music/settings.mjs` | 听歌程序 + 连接/断开动作（驻留内嵌） |
| `tools/plugin-demo/bt-music/ui.mjs` | CONNECTED / DISCONNECTED Toast 卡 |
| `tools/plugin-demo/README.md` | demo 索引与手测步骤 |

Debug 构建 junction：`tools/plugin-demo/bt-music` → `app_data/plugins/bt-music`。

## 子文档

- [windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md](windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md) — 检测真源、事件驱动、假阳性/假阴性与编码坑

## 关键约定

- **宿主不加蓝牙 API**；能力边界见 [[plugin-native-sidecar-runtime]]。
- Settings 只用宿主注入的 naive 组件（`NInput`/`NSwitch`/`NSelect`/`NTag`/`NButton`，**无** `NInputNumber`）。
- **Settings 产品文案**：不暴露 sidecar / PnP / DEVPKEY / payload。
- **启用即监听全部蓝牙耳机**：无关键词过滤；宿主顶栏启用插件 = 开始监听。
- **连接动作 `connectAction`**：`none` / `notify`（Toast）/ `launch`（直接启动）。互斥。
- **断开动作 `disconnectAction`**：`none` / `pause`（系统暂停键）/ `close`（结束听歌进程）。互斥；断开不再弹通知。
- 兼容旧字段：`autoLaunchOnConnect`→launch；`pauseOnDisconnect`→pause；旧 `notify` 断开→`none`。
- 连接通知驻留仅在 `connectAction=notify` 时显示（默认 5s）。
- Settings 改动 debounce 后 `config.set` + `setConfig`。

## 相关

- [[desktop-event-os]] / [[plugin-native-sidecar-runtime]] — sidecar 协议与 demo 里程碑
- [[timer-plugin]] — 另一外部插件参考（settings 布局 / naive 注入）
- [[toast-window]] — sticky / action resolved 回传 / auto_hide_ms
- [[plugin-center]] — 启用与详情面板
