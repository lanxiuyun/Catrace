# 插件后台逻辑迁到 sidecar：宿主能力 op 与「不建 WebView」的约定

> 2026-09-29（issue #82 第二期）。给 sidecar 的 JSONL 协议补齐宿主能力后，插件的后台逻辑可以整段搬进 node sidecar，宿主不再为它建隐藏 WebView——每个迁走的插件省掉一个 renderer 进程（约 60MB 私有内存 / 115MB 工作集）。
>
> 协议的上位设计见 [plugin-native-sidecar-runtime.md](plugin-native-sidecar-runtime.md)；本文记录 2026-09-29 新增的能力 op 与由此产生的约定。

## 1. 为什么以前必须在 WebView 里

`background.mjs` 住在隐藏 WebView（`plugin-bg-<id>`）里，不是因为需要界面，而是因为它调的宿主 API——`plugin.activity.get`、`plugin.clipboard.writeText`、`plugin.shell.openExternal`、`plugin.config.get/set`、`plugin.storage.set`——**当时只有 Tauri 的 invoke 通道能到，而 invoke 只在 WebView 里存在**。sidecar 那条 JSONL 通道当时只有 `publish` / `log` / `storage.get|set` / `resolved`。

所以要搬逻辑，前提是先把能力补进协议。宿主侧改动（`plugin_sidecar.rs` +281 行）比插件侧改动大，原因就在这里。**node 进程不是新起的**：迁走的插件本来就有 sidecar 在跑（GitHub API 轮询、webhook HTTP server），这次是把重复的一层折进已经在跑的进程，净效果是纯减法。

## 2. 新增的 sidecar → 宿主能力 op

全部沿用 `storage.get/set` 的模板：**带 `requestId`，宿主回 `op:"response"`**，超时 2.5s 按失败处理（插件侧应 fail-open，不要把通知静默丢掉）。

| op | 宿主实现 | 取代的 webview API |
|---|---|---|
| `activity.get` | 读 `ActivityState` + 全屏提醒状态，回 `{active, at}`，口径与 `plugin_api_get_activity` 一致 | `plugin.activity.get` |
| `clipboard.write_text` | `AppHandle::clipboard().write_text`（`ClipboardExt` 挂在 AppHandle 上，本来就不依赖 WebView） | `plugin.clipboard.writeText` |
| `shell.open_url` | `tauri_plugin_opener`，**只允许 http/https** | `plugin.shell.openExternal` |
| `config.get` | `plugin_config::get_plugin_config::<Value>` | `plugin.config.get` |
| `config.set` | 写 store + 广播 `catrace:plugin-config-changed`；未显式带 `enabled` 时保留存量值（同 webview 版约定） | `plugin.config.set` |

**鉴权**：统一走 `ensure_sidecar_plugin_usable`（已安装 + 已启用），等价于 webview 版的 `require_plugin_api` 但不需要窗口 label。webview 版靠 `plugin-bg-<id>` label 推导身份，sidecar 版靠进程在 `PluginSidecarManager` map 里的 key。

**入站 op 不信任 JSON 里的 pluginId**（沿用既有约定）。

## 3. 卡片动作：`resolved` 本来就带 payload

`bus.rs::notify_plugin_resolved` 构造的 payload 一直包含 `eventId / eventType / kind / payload / actionId / resolutionKind / resolutionPayload`，并且同时投给两处：有后台窗就 emit `catrace:plugin-event-resolved`，有 sidecar 就写 stdin `op:"resolved"`。

所以迁移动作处理**不需要改宿主**：sidecar 直接读 `actionId` + `payload` 就能做「打开链接 / 复制验证码 / 屏蔽」这类动作。旧的 `window.addEventListener('catrace:plugin-event-resolved')` 那条 DOM 通道只服务于 background.mjs。

## 4. 什么必须留在 WebView

- `ui.mjs` — Toast 卡片渲染，本质是 UI
- `settings.mjs` — 设置页，跑在主窗里
- 需要**页面级能力**的逻辑（DOM、布局测量、`performance.memory` 之类）

只有「无界面的调度 / 动作处理」才适合搬。宿主也**仍然支持** `background` 字段（timer、notify-demo 还在用）。

## 5. 约定

1. **新插件不要再新增 `background` 字段**，后台逻辑直接写在 `runtime/main.mjs`：定时器用 `setInterval`，读活跃用 `activity.get`，发卡片用 `publish`。插件仓库 SKILL.md / develop.md 已同步这条。
2. 存量 background 插件不必急迁，可渐进；迁移范本是两个官方插件（github-notify 0.2.0 / smsforwarder-notify 0.1.8）。
3. sidecar 启动**不能等 config push**：宿主只在「存过一次配置」后才推 config，新启用的插件会永不启动。`ready` 之后立即自启（pastedrop 的注释里记过这个坑）。
4. 能力 op 拿不到结果时 fail-open：门控类逻辑（如 `onlyWhenActive`）应按「未知即放行」处理，宁可多弹也不要静默丢通知。

## 6. 迁移清单（两个插件实际改了什么）

| 插件 | background.mjs 原本做什么 | 迁移后 |
|---|---|---|
| github-notify 0.1.1 → 0.2.0 | 每 5s `activity.get` → 写 `activity_pulse`；再把活跃状态经 `sidecar.request('setActivity')` 转发给 sidecar（**只在设置页开着时生效**）；处理「打开」动作 | 5s 心跳搬进 sidecar，直接更新内存门控 + `storage.set('activity_pulse')`；`resolved` 里 `actionId==='open'` → `payload.html_url` → `shell.open_url` |
| smsforwarder-notify 0.1.7 → 0.1.8 | 每 5s 写 `activitySnapshot`；`copy-otp` / `copy-body` 写剪贴板；`block-app` / `block-title` 改配置后转发 sidecar | 心跳搬进 sidecar 写同一个 key；四个动作在 `resolved` 里处理，OTP 提取复用 sidecar 里更强的 `extractOtp` |

**顺带修好的一个旧缺陷**：github-notify 原来靠设置页转发活跃状态，设置页关着时门控退化为「一律放行」。搬进 sidecar 后自己轮询，不再依赖任何窗口。

## 7. 坑

**（1）config 整写会丢字段 → 必须读-改-写**

sidecar 的 `normalizeConfig` 会把某些字段硬编码（如 smsforwarder 的 `hideSensitiveBody: false`），拿内存 config 整包 `config.set` 会把用户设置抹掉。正确做法：动作里先 `config.get` 读宿主存量 → 改 → `config.set` 整包写回，然后同步受影响的数组到内存。

**（2）`enabled` 归宿主管**

`config.set` 与 webview 版 `set_plugin_config` 同一约定：payload 没显式带 `enabled` 就保留存量值，防止插件整写把自己的开关冲成 false（历史 bug 见 [../../bugs/2026-08-02-set_plugin_config整包写入冲掉外部插件enabled.md](../../bugs/2026-08-02-set_plugin_config整包写入冲掉外部插件enabled.md)）。

**（3）`shell.open_url` 比 webview 版更严**

sidecar 的入参来自进程外输入，只放行 http/https（webview 版没做 scheme 校验）。

## 8. 已知缺口

- **内存异常看门狗失去样本**：`plugin_report_memory` 只由 `PluginHost.vue`（插件后台窗）每 15s 上报，插件没有后台窗后就不再被采样，插件页的「连续高内存」异常标签对这类插件失效。事件突增 / 存储写入 / 单次大数据那几类判定不受影响。若要补，方向是宿主侧按 pid 采样 sidecar 内存（`record_memory_activity` 本身与窗口无关，可直接复用）。
- **运行中打开轻量模式**：启动期已预创建的 Toast 会留到下次弹完卡片（见 [轻量模式省下的是哪些进程-WebView2进程构成与排查方法.md](../../features/lightweight-mode/轻量模式省下的是哪些进程-WebView2进程构成与排查方法.md) 的坑 2）。
- **旧宿主 + 新插件**：宿主不认识新 op 时超时，门控 fail-open；github-notify 会在每次心跳失败时记一条 warn（5s 一次，可能刷日志）。

## 9. 相关

- [plugin-native-sidecar-runtime.md](plugin-native-sidecar-runtime.md) — M15 sidecar 设计真源（进程拓扑、manifest、生命周期）
- [sidecar-storage往返协议与Plugins-UI运行态约定.md](sidecar-storage往返协议与Plugins-UI运行态约定.md) — storage 往返的实现细节
- [插件配置和运行数据必须分开存储.md](插件配置和运行数据必须分开存储.md) — 为什么配置走 store、运行数据走 storage
- [../../features/lightweight-mode/README.md](../../features/lightweight-mode/README.md) — 本次迁移服务的轻量模式
- [[plugin-center]] · [[desktop-event-os]]
