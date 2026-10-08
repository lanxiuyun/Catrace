# 系统通知转发（Windows System Notification Forward）

> 把 Windows 应用发出的通知收进 Catrace，用 Catrace 的 Toast 卡片显示，而不是只在系统右下角弹一下。设置入口：设置 → 系统通知。**仅 Windows**（其他平台开关置灰，状态显示「当前平台不支持」）。

## 行为

| 项 | 说明 |
|---|---|
| 总开关 | `settings` 表 key `notification_forward_enabled`（默认关）。开启时现场申请/检查系统「通知访问」授权 |
| 授权状态 | 开关旁标签显示 `已授权 / 未授权 / 待授权`；被拒或待授权且尝试过开启（或运行中被撤销）时，给一个直达 `ms-settings:privacy-notifications` 的按钮；授权后回到 Catrace（窗口重新聚焦）自动刷新状态 |
| 捕获 | 每秒拉一次系统通知列表，新出现的才转发（见下「为什么是纯轮询」） |
| 首次开启 | **静默对账**：操作中心里已存在的通知只记入已知集合，**不补弹**。所以「开启前收到的通知」永远不会出现，测试时必须先开开关再发通知 |
| 卡片 | 应用图标 + 应用名 + 标题 + 正文，约 6 秒自动收起；走 `kind = notification` 的内置卡 |
| 按钮 | toast XML 里带按钮的通知，卡片底部渲染可点击按钮：`protocol` 直接打开目标 URI；`background/foreground` 通过应用注册的通知激活器忠实触发（本机剪映实测）。打包应用（activator 在 PackagedCom 目录，代点不到）与带输入框的按钮不渲染。点击成功 → 卡片消失 + 操作中心源通知被移除（对齐原生点击）；失败 → 提示 + 卡片保留可重试。protocol 目标没有处理程序时（死链接），Windows 自己弹「获取打开此链接的应用」对话框，ShellExecute 仍返回成功——Catrace 按成功处理，卡片照常收走（2026-09-30 实测） |
| 本体点击 | 点卡片**本体**触发 toast 根元素 `launch`/`activationType` 的主操作（等价于原生点通知本体的跳转）。可触发规则与按钮一致：`protocol` 直开；`background/foreground` 需应用注册了激活器；打包应用无激活器则整卡不可点。`launch` 缺失/为空 → 整卡不可点（原生点击也只是收起）。可点时整卡显示手型光标；点 X / 按钮不冒泡不误触。走同一条 `trigger_notification_action`（保留 action id `launch`），成功后行为与按钮点击一致（2026-10-01 补齐：此前只解析 `<action>` 按钮，本体点击无反应） |
| 不再弹系统横幅 | `notification_takeover_enabled`（默认关）。开启后给每个应用写注册表 `ShowBanner=0`，系统**根本不画**那条横幅；通知照常进操作中心、照常被转发（唯一例外：新应用首条——横幅已被画出，Catrace 收走它时会连操作中心条目一起删掉）。开启时弹确认框（会改系统设置）。v1 没有「按应用静音」——想屏蔽某个应用去 Windows 设置里关它的通知（平台级，横幅/操作中心/转发一起停） |

发布到事件总线的事件：`event_type = system.notification.received`、`kind = notification`、`dedupe_key = notification:{系统通知 id}`、`payload = { app_name, aumid, icon_data_url, auto_hide_ms, body_clickable }`（`body_clickable` = 本体是否有可触发的主操作，前端据此显示手型光标并绑点击）。

## 涉及文件

- `src-tauri/src/notification_listener.rs` — 全部逻辑：worker 线程、轮询、解析、发布、移除、按钮与主操作的读取与触发、设置存取与五个命令（`get_notification_forward_status` / `set_notification_forward_enabled` / `set_notification_takeover_enabled` / `open_notification_permission_settings` / `trigger_notification_action`）
- `src-tauri/src/lib.rs` — `mod`、setup 里注册状态并按设置恢复监听、命令注册
- `src/components/settings/SysNotifySettingsCard.vue` — 设置卡（注册进 `Settings.vue` 的 `CORE_GROUP_KEYS`，i18n 组名 `sysNotify`）
- `src/components/NotificationToastCard.vue` — 卡片；`ReminderToast.vue` 的 `BUILTIN_TOAST_KINDS` 加 `notification` 并加模板分支
- `src/api/tauri.ts` / `src/i18n/locales/*` — 命令封装与文案

## 子文档

- [quick-reply-input-boxes-why-not-built-and-how-to-add.md](quick-reply-input-boxes-why-not-built-and-how-to-add.md) — 带输入框的按钮为何不渲染，要做时的框架与成本

## 实现要点（为什么必须这样）

- **`NotificationChanged` 事件订阅对未打包进程不可用**：实测 `0x80070490 (ERROR_NOT_FOUND)`，MTA 与显式 STA 线程都一样；能读能删，就是订不上事件（WinIsland 的注册也包在 try/catch 里、注释写着 relying on polling，是同一个坑）。所以**只能纯轮询**，事件订阅只作为「订上就更快」的可选增强，**失败绝不让开关失败**。轮询周期因此取 1s（它就是卡片延迟和原生弹窗被移除前的可见时长）。
- **WinRT 对象有单元/线程亲和性，不能跨线程使用**：曾经在 Tauri 命令线程上 `Current()` 拿 listener、交给 worker 线程轮询，结果每次 `GetNotificationsAsync` 都 `0x8001010E (RPC_E_WRONG_THREAD)`「已为另一线程整理的接口」。现在整条 WinRT 会话（`CoInitializeEx(MULTITHREADED)` → `Current()` → 订阅 → 轮询 → `RemoveNotification`）都在 worker 自己的线程里建立并使用；命令线程只做一次用完即弃的授权探测（`probe_access`）。无 GUI 测试里「同线程创建同线程使用」看不出这个问题，别用它当验证。
- **事件通道要保活，`Disconnected` 也不能退出**：订阅失败时 handler 未被注册、随作用域析构，而它持有 mpsc 发送端——发送端没了通道即断开，`recv_timeout` 立刻返回 `Disconnected`，worker 秒退（症状：日志里 `listener started` 与 `listener stopped` 记在同一秒、一条通知都捕获不到）。因此 worker 留一份保活发送端，并且 `Disconnected` 分支只睡一轮继续轮询（**必须显式 sleep**：断开后 `recv_timeout` 立即返回，不睡就是忙等烧 CPU）。
- **每个 worker 用自己的停机标志**：用共享 `AtomicBool` 表示运行状态时，「关掉再打开」会出现旧 worker 尚未退出、新一次 start 又把标志置回 true → 两个线程各带一份已知集合同时轮询。现在 `StateInner` 登记一份 `Arc<AtomicBool>`，`stop_worker` 置 true 并摘除，worker 自己退出走 `retire_worker`（只摘自己那份，不误杀后来者）。
- **AUMID 要用 `AppUserModelId()`，不是 `AppInfo.Id`**：后者实测多为空串、ChatGPT/Codex 返回 `"App"`（前者曾被误当 AUMID 用于按应用标识，已废弃该做法）。少数连 AUMID 都不上报的来源（系统权限提示等）退回**应用名**做标识。
- **按钮数据读自 wpndatabase.db，且必须在 RemoveNotification 之前读**：监听 API 只暴露文本（`NotificationBinding` 仅有 GetTextElements，`Notification` 连 Xml 属性都没有），按钮读自通知平台数据库的 Payload 列（toast XML）。三条实测约束：只读连接 `mode=ro` 不能加 `immutable=1`（会无视 WAL、读到陈旧快照）；被移除的通知在库里连行一起删；库里的 `Notification.Id` 就是监听器的 id，按 id join 精确命中。点击 background/foreground 走 CustomActivator（`CoCreateInstance` + `INotificationActivationCallback::Activate`，等价于系统原生点击后的调用，InprocServer32 的激活器 DLL 会加载进本进程——原生机制本就如此）；打包应用的 activator 在 PackagedCom 目录代点不到，这类按钮不渲染；带输入框的跳过记 `needs input`（快捷回复刻意不做）。前端点击只回传 event id + action id，规格按 event id 存在宿主内存里（35s TTL / 点击成功即清除）；点击成功后源通知由命令线程投递、worker 从队列消费 `RemoveNotification`——只有持有 listener 的 worker 能调它。通知**本体**的主操作同源同规则：`launch`/`activationType` 读自 toast XML 根元素（`activationType` 缺省 foreground），用保留 action id `launch` 与按钮共用同一条触发命令；`launch` 缺失说明原生点了也只是收起，整卡不可点。详见 notification_listener.rs 内「通知按钮与主操作」一节的注释。
- **先发布、成功后才收走，且只收「闪了一下」的那条**：`RemoveNotification` 实测是**整条移除**（操作中心条目一起删），所以只在 `bus.publish` 成功**且本次真的给新应用写了 ShowBanner=0** 时调用——横幅已被画出的那条才需要收，稳态通知必须留在操作中心，否则操作中心会被清空，和设置页文案的承诺矛盾。总线失败时保留系统通知，保证消息至少在一处可见。事件另外在 35s 后兜底 resolve（前端自动收起时也会 resolve，后端这层是安全网），避免 Toast 窗重建时把旧通知重新水合出来。
- **「不再弹系统横幅」只能靠注册表**：`RemoveNotification` 只能移除已经画出来的弹窗、拦不住绘制（纯轮询下原生弹窗会先画出来），所以要让系统别画——在 `HKCU\…\CurrentVersion\Notifications\Settings` 下给每个应用写 `ShowBanner=0`。**实测确认抑制横幅不影响投递**：写上之后通知仍被监听器收到（`forwarding` 日志照常出现）。系统里该键默认**没有** `ShowBanner` 值（= 显示横幅），所以抑制是写 0、还原是删值或恢复记录到的原值。
- **必须递归下钻**：扁平 AUMID（`Chrome`、`Microsoft.PowerToysWin32`）的设置就在 Settings 的直接子键上，而**路径式 AUMID**（`{1AC14E77-…}\WindowsPowerShell\v1.0\powershell.exe`，传统 Win32 应用多为此类）被平台存成**嵌套子键**——只扫一层会漏掉这整类应用（实测 38 个应用里就漏了 PowerShell）。容器层也会被写上 `ShowBanner=0`（无害，计数与日志按「键」而非「应用」表述）。
- **`windows_registry::Key::open` 是只读的**：它只请求 `KEY_READ`，拿它写值会静默失败，表现为「枚举到了子键但改动数为 0」——整个接管功能会无声失效。写操作必须走 `options().read().write().open()` 或 `create()`；这里封了个 `open_rw` 统一处理。这个坑是注册表往返测试抓出来的。
- **改系统设置必须有还原路径**：改动前把原值记进 settings 表（`notification_takeover_backup`），以下时机还原——关「不再弹系统横幅」、关整个功能（否则通知既无原生横幅也不转发，只能去操作中心翻）、**应用退出**（`RunEvent::Exit`，Catrace 不在了就没人转发）。启动时按当前开关对齐一次（`reconcile_takeover`），上次硬杀留下的状态能自愈；启动时若监听没起来（如授权已被撤销，`maybe_start` 失败）也立即还原——没有转发在跑就不该继续压制。
- **suppress 与 restore 必须互斥，suppress 前要重读开关**：关开关时 worker 可能还在处理最后一条通知（停机标志只在轮询循环顶部检查，在途的那条会走完全流程），不加锁时「restore 刚还原完、suppress 又写回 0」会留下既无横幅也无转发的孤儿值。所有 ShowBanner 读写共用 `TAKEOVER_LOCK`；`suppress_banner_for` 在锁内重读两把开关，关了就不写。restore 只把**成功还原**的条目移出备份，失败的留着下轮 reconcile 重试（无脑清空备份会把没还原成的键变成孤儿；键打不开先用只读探测区分「键已不存在→放弃」与「写句柄打开失败→保留重试」）；备份写失败打 error 日志——写失败 = 已压下去的值从此没有还原依据。
- **文本解析**：`ToastGeneric` binding 的文本元素是**两个**（标题、正文，实测确认）；正文截 200 字、标题截 120 字（系统级提示会把整段说明塞进标题，不截会撑出很高的卡）。取图标失败、单条解析失败都不影响其他通知。
- **日志只记来源与长度**（`forwarding app=… id=… title_len=… body_len=…`）：通知正文可能是敏感信息，不落盘。这行也是「监听器到底收到没有」的判据。

## 已知取舍

- **某个应用的第一条通知仍会闪一下**：我们只能在收到通知之后才知道它的 AUMID，所以那条的横幅已经画出来了；代码随即给该应用写上 `ShowBanner=0`，**后续**通知不再弹。开启接管时会把系统里已知的全部应用一次性处理好，所以只有「开启之后第一次出现的应用」会闪。这条闪过的通知会被 Catrace 收走（`RemoveNotification` 连操作中心条目一起删），其余通知都留在操作中心。
- **没有 AUMID 的来源压不住**：少数系统提示不上报 AUMID（此时 `app_key` 退回应用名），无法写注册表，其横幅照旧会闪。
- **硬杀进程会留下抑制状态**：`RunEvent::Exit` 跑不到时（任务管理器结束进程、崩溃）系统横幅保持被压制，直到下次启动 Catrace 时自愈（开关开着就重新对齐、关着就还原）。
- **还原以我们记录的值为准**：接管期间用户若在 Windows 设置里手动改过某应用的横幅开关，还原时会被我们记录的原值覆盖。
- **未打包进程可用是实测结论、非微软承诺**：Win11 26200 实测可用，NSIS 分发链路不用动。若未来失效，回退方向是 sparse package 身份或直读 `wpndatabase.db`。
- 应用图标：部分来源 `GetLogo` 取不到（返回空），卡片退回首字母圆形占位。

## 测试

手动测试脚本在工位 `e2e-temp/`（已 gitignore、不入库）：`catrace-toast.ps1` 发真实 toast（借 Windows PowerShell 已注册的 AUMID，否则静默失败），`probe-listener.ps1` 打印监听 API 当前能读到什么，`cleanup-test-toasts.ps1` 清理测试通知，`notif-launch-test.ps1` 发「带 protocol 主操作 + 无主操作对照」两条通知验证卡片本体点击（纯 ASCII，无需 BOM）。改动这些脚本要保留 **UTF-8 BOM**，否则 PowerShell 5.1 按 GBK 解码中文会截断引号。**`leaf-test.ps1` 往真实注册表叶子键写 `ShowBanner=0`，跑完必须跟 `clean-manual.ps1` 还原**——残留的 0 会在下次接管开启时被当成「原值」记进备份，之后每次还原都忠实地还原回 0，横幅永远不出来（2026-09-30「无论如何不弹横幅」事故的根因）。

回归测试（纯逻辑 + 真实注册表沙箱，CI 可跑）：`cargo test --lib notification_listener` —— 通道保活、重启不留双 worker、按字符边界截断、接管「抑制 → 还原」往返（含路径式 AUMID 的嵌套叶子）、按钮与主操作 XML 解析（protocol / 输入框标记 / 实体展开 / 属性内未转义 `>` / 根元素 launch 与 activationType 缺省）、UTF-8 与 UTF-16LE payload 解码。沙箱在 `HKCU\Software\CatraceTest\<tag>`，跑完清理；每个用例用独立 tag，否则会被并行用例的 `remove_tree` 互相拆掉。
