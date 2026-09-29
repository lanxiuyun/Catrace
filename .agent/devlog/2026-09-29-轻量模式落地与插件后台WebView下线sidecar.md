# 2026-09-29 轻量模式落地，插件后台 WebView 下线 sidecar

## 会话目标

回应 [issue #82](https://github.com/lanxiuyun/Catrace/issues/82)「内存占用偏高」：让主界面不再常驻内存，并把每插件一个的隐藏后台 WebView 砍掉。两期一起做，过程中修掉两个窗口生命周期 bug，最后开 PR #83。

## 完成

- **轻量模式开关**（设置 → 系统，默认关）：主窗关闭即销毁、重新打开时按需重建；Toast 不预创建、卡片清空即销毁；开机自启 + 静默启动时直接销毁主窗
- **出口全部收敛到 `show_or_rebuild_main_window`**：托盘菜单、托盘双击、单实例二次启动、`show_main_window`、插件 `showMain`（原来主窗不存在时这些入口都是静默无操作）
- **修 bug 1**：主窗重建「创建即可见 + 手动 restore_state」导致主线程卡死（白屏未响应），改为先隐藏创建、几何交给 window-state 插件
- **修 bug 2**：窗口全关时 Tauri 默认退出应用；插件后台窗消失后暴露，改为拦 `ExitRequested{code:None}`
- **sidecar 协议加 5 个能力 op**：`activity.get` / `clipboard.write_text` / `shell.open_url` / `config.get` / `config.set`，与 `storage.*` 同模板（requestId + response + 2.5s 超时）
- **两个官方插件迁到 sidecar**：github-notify 0.2.0、smsforwarder-notify 0.1.8，删 `background.mjs` 与 manifest 的 `background` 字段（插件仓库 PR #8，宿主 PR #83）
- **插件仓库文档更新**：SKILL.md / develop.md 补新 op 契约与 resolved payload 说明，写明新插件不再建议用 `background`
- **收尾**：PR #83 的 submodule 指针从 squash 前的分支 commit 重指到插件 main tip；CI 四项全绿

## 实测收益（4 个插件）

| 状态 | msedgewebview2 | 合计工作集 |
|---|---|---|
| 改动前（常驻） | 8+ 进程（含底座） | ~800MB+ |
| 轻量模式 + 插件迁移后，托盘静默 | **0 个** | ~290MB |

WebView2 在最后一个 webview 销毁后会连底座一起收掉，比最初「底座省不掉」的预估更好。

## 遗留

- 插件页的**内存异常看门狗**对没有后台窗的插件失去样本（`plugin_report_memory` 只由后台窗上报）；事件/存储那几类判定不受影响
- **运行中打开轻量模式**时，启动期已预创建的 Toast 会留到下次弹完卡片才销毁
- 旧宿主 + 新插件组合下，github-notify 每次心跳失败会记一条 warn（5s 一次，可能刷日志）
- PR #83 待合并（先合插件仓库 #8，已完成）

## 关键文件改动

| 文件 | 改动 |
|------|------|
| `src-tauri/src/lib.rs` | 轻量模式开关、主窗销毁/重建、`ExitRequested` 拦截、Toast 销毁分支 |
| `src-tauri/src/plugin_sidecar.rs` | 5 个宿主能力 op（+281 行）+ 解析单测 |
| `src-tauri/src/reminder_toast.rs` | `request_destroy_toast_window`（走 `TOAST_MUTEX`） |
| `src/components/settings/SystemSettingsCard.vue` / `src/api/tauri.ts` | 开关 UI 与 invoke 封装 |
| `tools/plugin-demo/github-notify` `smsforwarder-notify` | 后台逻辑迁入 `runtime/main.mjs`，删 `background.mjs` |
| `.agent/features/lightweight-mode/` | 行为、内存账本与排查方法 |

## 沉淀

- [features/lightweight-mode/](../features/lightweight-mode/README.md)（README + 进程构成与排查方法）
- [architecture/desktop-event-os/插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md](../architecture/desktop-event-os/插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md)
- [bugs/2026-09-29-轻量模式关掉最后一个窗口整个应用退出.md](../bugs/2026-09-29-轻量模式关掉最后一个窗口整个应用退出.md) · [bugs/2026-09-29-轻量模式重建主窗白屏未响应.md](../bugs/2026-09-29-轻量模式重建主窗白屏未响应.md)
- [reference/插件子仓库submodule-合并后重指指针与本地git拉取问题.md](../reference/插件子仓库submodule-合并后重指指针与本地git拉取问题.md)
