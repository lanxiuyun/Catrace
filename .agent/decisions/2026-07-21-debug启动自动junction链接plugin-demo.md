# debug 启动自动 junction 链接 plugin-demo

## 状态

Accepted — 2026-07-21

## 背景

M10 外部插件从 `app_data/plugins/<id>` 扫描。开发时每次手动拷贝 `tools/plugin-demo/*` 很烦；复制还会和源码脱节。

## 决策

**仅 debug 构建**：`PluginManager` 首次扫描前，把仓库 `tools/plugin-demo/*`（含 `manifest.json` 的目录）**link** 到应用 plugins 根目录。

- Windows：优先 `mklink /J`（junction，无需管理员）
- Unix：symlink
- 已正确 link → 跳过
- 目标已是真实目录或其他链接 → **不覆盖**
- release 构建：整段 `#[cfg(debug_assertions)]`，不参与

## 为何 link 不 copy

- 改 demo 源码即时生效，无需再同步
- 避免 app_data 里出现过期副本被当成权威

## 实现位置

`src-tauri/src/plugins.rs`：

- `initial_scan` → `ensure_dev_plugin_links`
- `ensure_dir_link` / `create_dir_link`

路径：

- 源：`CARGO_MANIFEST_DIR/../tools/plugin-demo/<id>`
- 目标：`app_data/plugins/<id>`（Windows 约 `%APPDATA%\\com.lanxiuyun.catrace\\plugins`）

## 后果

- 本地 dev 启动即可在 Plugins 页看到 demo-timer（仍需用户 enable）
- 用户若在同名路径放了自己的插件目录，dev link 不会踩掉
- 文档手测步骤可从「手动拷贝」改为「debug 自动 link；亦可手动 junction」

## 相关

- 架构：[[desktop-event-os]] M10
- 文档：`.agent/architecture/desktop-event-os/m10-external-plugins.md`
