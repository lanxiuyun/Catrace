# 全屏提醒

双层背景 + 自定义元素变换的全屏休息提醒模式。

> **2026-07-21**：产品侧久坐插件**暂不启用**全屏提醒，只走 toast。  
> 本目录描述的窗口 / 配置 / 变换能力**代码仍保留**，但 `RestPluginPanel` 无入口，  
> `show_notification` 不再分支到 fullscreen。详见 [[reminder]] toast-only 子文档与  
> [popup-removal-pending.md](../../decisions/popup-removal-pending.md)。

## 涉及文件

- `src/views/ReminderFullscreen.vue` — 全屏提醒窗口
- `src-tauri/src/lib.rs` — 背景图存储（base64↔文件）、`set_fullscreen_settings` 命令

## 背景图

- 前端上传 data URL → Rust 解码存磁盘（`app_data_dir/bg/`），DB 只存文件路径
- 读取时 `resolve_bg_for_frontend()` 转回 data URL
- 默认图：bundled `src-tauri/assets/catrace.png`，首次启动复制到 app_data_dir
- 双层背景：底层 `blur(40px)` 放大铺满 + 上层清晰居中

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
