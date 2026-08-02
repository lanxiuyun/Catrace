# bt-music（蓝牙听歌）

外部插件：蓝牙耳机真连接后通知/启动听歌程序。**无宿主蓝牙 API**；检测与 spawn 全在 sidecar。

## 一句话

启用插件 → sidecar 订阅 `Win32_DeviceChangeEvent` → 扫 PnP（`IsConnected=True`）→ 按 `connectAction` / `disconnectAction` 动作 → 连接 Toast（紧凑横条）或直接启动。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/bt-music/manifest.json` | id=`bt-music`，sidecar `node runtime/main.mjs` |
| `tools/plugin-demo/bt-music/runtime/main.mjs` | 事件监听、动作、启动/暂停/关闭、图标提取、JSONL |
| `tools/plugin-demo/bt-music/settings.mjs` | 听歌程序 + 连接/断开动作（驻留内嵌） |
| `tools/plugin-demo/bt-music/ui.mjs` | 紧凑 Toast：图标 +「设备名 已连接」+ 启动/关闭 + 进度条 |
| `tools/plugin-demo/README.md` | demo 索引与手测 |

Debug junction：`tools/plugin-demo/bt-music` → `app_data/plugins/bt-music`。

## 子文档

- [windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md](windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md) — 事件驱动检测、延迟优化、编码
- [连接断开动作模型与紧凑Toast卡.md](连接断开动作模型与紧凑Toast卡.md) — connect/disconnect 互斥动作、卡 UI、payload 字段

## 关键约定

- **宿主不加蓝牙 API**；见 [[plugin-native-sidecar-runtime]]。
- **启用即监听全部蓝牙耳机**：无关键词、无独立 listen 开关；顶栏启用 = 监听。
- **连接** `connectAction`：`none` / `notify` / `launch`（互斥；launch 不弹 Toast）。
- **断开** `disconnectAction`：`none` / `pause` / `close`（互斥；断开不弹通知）。
- Settings 产品文案，无 sidecar/PnP 术语；naive 无 `NInputNumber`。
- `plugin.config.set` 整包写入时宿主保留 `enabled`（见 [[插件配置和运行数据必须分开存储]]）。
- Toast 进度条用 CSS + `--toast-auto-hide-ms`，hover 只 pause；见 [[toast-window]] 子文档。
- 改 `ui.mjs` 后插件页刷新即可热更，无需重启 dev；见 Toast 热更新文档。

## 相关

- [[desktop-event-os]] / [[plugin-native-sidecar-runtime]]
- [[toast-window]] / [[plugin-center]] / [[timer-plugin]]
