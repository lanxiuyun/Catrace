# bt-music（蓝牙听歌）

外部插件：蓝牙耳机真正连上后 Toast，可一键打开听歌程序。**无宿主蓝牙/业务 Rust API**；检测与 spawn 全在 sidecar。

## 一句话

启用插件 → Node sidecar；默认只靠「模拟连接」验收；可选 Windows PnP 轮询（`DEVPKEY_Device_IsConnected=True`）→ `publish` → Toast → action `open-player` 由 sidecar `spawn`。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/bt-music/manifest.json` | id=`bt-music`，sidecar `node runtime/main.mjs`，events 白名单 |
| `tools/plugin-demo/bt-music/runtime/main.mjs` | 轮询 / 模拟 / open-player / JSONL bridge |
| `tools/plugin-demo/bt-music/settings.mjs` | 监听开关、过滤、播放器路径、模拟按钮 |
| `tools/plugin-demo/bt-music/ui.mjs` | CONNECTED / MOCK / DISCONNECTED Toast 卡 |
| `tools/plugin-demo/README.md` | demo 索引与手测步骤 |

Debug 构建 junction：`tools/plugin-demo/bt-music` → `app_data/plugins/bt-music`。

## 子文档

- [windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md](windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md) — 检测真源、假阳性/假阴性与编码坑

## 关键约定

- **宿主不加蓝牙 API**；能力边界见 [[plugin-native-sidecar-runtime]]。
- Settings 只用宿主注入的 naive 组件（有 `NInput`/`NSwitch`/`NTag`，**无** `NInputNumber`）。
- 轮询默认 **关**（`watchEnabled: false`），避免本机已配对设备刷 Toast。
- 首轮成功快照只 seed，不 publish；之后才对 delta 发连接/断开。
- Toast 仍是可见权威；sidecar `publish` 走 Event Bus。

## 相关

- [[desktop-event-os]] / [[plugin-native-sidecar-runtime]] — sidecar 协议与 demo 里程碑
- [[timer-plugin]] — 另一外部插件参考（settings 布局 / naive 注入）
- [[toast-window]] — sticky / action resolved 回传
- [[plugin-center]] — 启用与详情面板
