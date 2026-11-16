# 全屏提醒

双层背景 + 自定义元素变换的全屏休息提醒模式。

> **2026-08-28**：久坐插件重新启用全屏提醒（`reminder_mode=fullscreen`）。  
> 独立全屏窗先落到**光标所在监视器**，再 OS fullscreen（含任务栏），显示休息倒计时。popup 仍不下线恢复。
>
> **2026-09-21**：全屏提醒改为**每块屏一扇窗**（`reminder-fullscreen-0`…），跳过/稍后关掉全部。单窗 OS fullscreen 只能盖光标那一块屏（[#22](https://github.com/lanxiuyun/Catrace/issues/22)）。

## 涉及文件

- `src/app/windows/ReminderFullscreen.tsx` — 全屏提醒窗口控制器：倒计时、稍后/跳过、关闭窗口与元素编辑
- `src/components/FullscreenReminderScene.tsx` — 实际窗口与设置预览共用的纯画面（双层背景、文字、倒计时、按钮）
- `src/components/fullscreenReminderModel.ts` — 共用的元素变换解析、位置样式和时间格式
- `src/components/FullscreenReminderPreview.tsx` — 设置页 16:9 缩放容器，不启动窗口行为
- `src/app/pages/plugins/RestSettings.tsx` / `src/app/pages/Plugins.tsx` — 预览输入与配置读取/保存
- `src-tauri/src/lib.rs` — 背景图存储（base64↔文件）、按监视器创建/关闭全屏窗、`set_fullscreen_settings`
- `src-tauri/src/window_manager/shared.rs` — 编号 label 与多屏 placement
- `src-tauri/capabilities/default.json` — `reminder-fullscreen-*`

## 背景图

- 前端上传 data URL → Rust 解码存磁盘（`app_data_dir/bg/`），DB 只存文件路径
- 读取时 `resolve_bg_for_frontend()` 转回 data URL
- 默认图：bundled `src-tauri/assets/catrace.png`，首次启动复制到 app_data_dir
- 双层背景：底层 `blur(40px)` 放大铺满 + 上层清晰居中

## 设置页实时预览

- 设置页背景区域不再只展示原图，而是嵌入同一份 `FullscreenReminderScene`；标题、内容、休息时长、背景透明度和填充方式随本地配置立即更新，不等待 500ms 防抖保存。
- 画面在 `80rem × 45rem` 的逻辑视口中绘制，通过 `ResizeObserver` 统一缩放进 16:9 容器，字体、按钮、模糊背景与元素百分比位置一起缩放，不能直接塞进小容器后让文字重排。
- 预览读取 `element_transforms`，与真实窗口共用默认值和解析函数；保存普通背景配置时仍传空字符串 sentinel，不能把默认布局写回去覆盖用户编辑结果。
- 预览子树 `inert` + `aria-hidden`，由外层提供预览名称；不挂载 `ReminderFullscreen` 控制器，不启动定时器，也不调用 Tauri 窗口或提醒命令。倒计时显示当前有效休息时长的静态初值。
- 空标题/正文使用与 Rust 一致的 `reminder.defaultTitle/defaultBody`（中文“休息提醒 / 站起来休息一下吧。”）；只有空字符串触发回退，不 trim 用户输入。中英文默认值改动需与 `rest_plugin.rs` 一起核对。
- 透明度同时作用于模糊层和清晰层，不能把整个预览设 opacity（文字也会消失）。`0` 是合法值，读取时用 `?? 80`，不能用 `|| 80`。
- 底纹仅表示透明度，不是桌面截图；16:9 也不保证与每块显示器的比例一致。
- 清除背景在后端会恢复 bundled 默认图。保存后重新读取结果，仅在本地仍是同一份配置快照时回填，防止迟到结果覆盖新选择。

## 元素独立编辑

标题、正文、倒计时、按钮可独立调整位置、缩放、旋转，存为 `fullscreen_element_transforms` JSON。

编辑流程：点右上角锁 → 编辑模式 → 点元素选中 → 拖动/滚轮/滑块调整 → 锁定保存。

## 配置

| 配置名 | 说明 | 默认值 |
|--------|------|--------|
| `reminder_mode` | 提醒模式（toast/popup/fullscreen） | toast |
| `fullscreen_bg_image` | 背景图 | bundled catrace.png |
| `fullscreen_opacity` | 遮罩透明度（0-100） | 80 |
| `fullscreen_fit_mode` | 背景填充（contain/cover/fill） | contain |
| `fullscreen_element_transforms` | 元素变换 JSON | 默认居中 |

## 约束

`set_fullscreen_settings` 在 `element_transforms` 为空字符串时保留已有值，避免 Settings 页调整背景覆盖用户在提醒页做的元素编辑。

settle 是否把这一分钟记成休息，只看 `reminder-fullscreen` 窗口在不在（`get_webview_window`），不读进程内 `AtomicBool`。窗口没了就必须按真实键鼠/媒体算活跃。详见 [settle只看全屏窗口是否存在-不要缓存fullscreen_active.md](settle只看全屏窗口是否存在-不要缓存fullscreen_active.md)。
