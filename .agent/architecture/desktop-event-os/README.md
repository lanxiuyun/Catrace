# Desktop Event OS

Catrace 以统一 **Event Protocol + Bus + Toast 渲染**承载桌面通知，并以 **Signal 行为感知**提供本地活动数据。主窗口采用 React，Toast / 提醒窗口与外部插件设置通过 Vue 岛挂载。

## 模块布局

```text
src-tauri/src/
├── event.rs / bus.rs       # 协议、Registry、publish/update/resolve
├── event_http.rs           # 外部 Event API 127.0.0.1:23457
├── plugins.rs             # 插件清单、扫描、启停、源码读取
├── plugin_repository.rs   # 仓库目录、固定 commit 下载与安装
├── plugin_sidecar.rs      # sidecar 进程与 stdio JSONL
├── plugin_window.rs       # 可选插件后台 WebView 生命周期
├── plugin_api/            # 通用宿主原语
├── plugin_commands.rs     # 身份、所有权、活动观测与输入边界
├── signal.rs / db.rs      # 行为采集与 signal_minutes
├── reminder_toast.rs      # Toast 窗口创建、定位与显示
├── agent_hook.rs          # Agent Hook 127.0.0.1:23456
├── rest_plugin.rs         # 内置久坐提醒与计时事件
└── lib.rs                 # 宿主启动、命令注册与结算组合

src/
├── app/                   # React 路由、主窗、页面与 Vue 岛桥
├── views/toastWindows/    # ReminderToast / Popup / Fullscreen / PluginHost
├── components/            # Toast 卡与共享 Vue 组件
├── stores/                # Event Hub / plugin registry（Pinia）
└── plugins/               # 插件注册、Blob 加载与宿主 API
```

外部插件代码在独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 维护，宿主通过[插件中心](../../features/plugin-center/README.md)安装和管理。

## Event 与 Signal

| 线 | 职责 | 边界 |
|---|---|---|
| Event | 有什么事、怎样展示、怎样 resolve | Toast 订阅 Bus 渲染内容 |
| Signal | 桌面上正在发生什么 | 不自动 createEvent |

## 关键约定

1. **内容只走 Bus**：rest / timer / agent / permission / update 均 publish；主窗 Hub 不渲染第二张卡。
2. **窗口与内容分离**：`ensure_toast_window_visible` 管窗口，Toast listen 后用 `get_active_events` 水合。
3. **生命周期与业务分离**：action resolve 记录生命周期；snooze / permission HTTP 等业务由对应 command 处理。Agent 会话销卡另走 `dismissAgentSession`。
4. **外部写入走 :23457**：SDK / plugin 源校验身份与 kind，管理入口在调试页。
5. **插件启用即信任**：安装默认停用。启用后可执行 WebView / sidecar 代码；宿主按插件 id 强制启用状态、Event 所有权和 storage namespace。
6. **后台身份不可自报**：WebView 从 `plugin-bg-<id>` label 推导；sidecar 从 manager running map 推导。
7. **后台逻辑优先 sidecar**：只有需要 DOM / 页面能力时使用 `background`，避免每插件创建隐藏 WebView。
8. **插件窗口同步不得阻塞主循环**：setup / 主线程回调不直接执行整段建窗同步，使用 `PluginWindowManager::schedule_sync()`。
9. **Signal 隐私**：键序列默认关闭，休息判定使用 `count`，见[采集与隐私](signal-collection-schema-and-privacy.md)。

## 按任务查阅

- 前端入口、路由、状态、Vue 岛：[前端架构](../react-migration/README.md)
- 仓库发现、安装、启停、卸载、信任：[插件中心](../../features/plugin-center/README.md)
- 外部 HTTP：[Event API](m9-event-http-api.md)
- UI/settings 加载与插件合同：[外部插件](m10-external-plugins.md)
- 后台协议与宿主能力：[sidecar 运行时](plugin-native-sidecar-runtime.md)
- sidecar storage：[往返协议](sidecar-storage往返协议与Plugins-UI运行态约定.md)
- 后台结构选择：[sidecar 与后台 WebView 边界](插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md)
- Windows 子进程回收：[Job Object](sidecar孤儿进程清理-Windows-Job-Object实现.md)
- 音频与资源路径：[音频 API](plugin-audio-rodio独立线程与getPluginDir.md)
- 用户配置与运行数据：[存储边界](插件配置和运行数据必须分开存储.md)
- Event 生命周期：[协议与 Bus](event-protocol-and-bus-lifecycle.md)
- Toast 渲染：[内容入口](toast-renders-only-from-event-bus.md)
- 内置久坐提醒：[插件边界](rest-reminder-builtin-plugin-boundary.md)
- Signal 调试：[分钟桶](debug-页-signal-分钟桶展示.md)
