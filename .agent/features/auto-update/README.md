# 自动更新检查

基于 Tauri 官方 `tauri-plugin-updater`（v2.10.1），latest.json 托管在 GitHub Release。用户可换源：自动依次尝试镜像，或锁定某一个。更新弹窗的可读说明由官网 `/latest/` 页面提供，官网版本说明按最新内容维护。

## 涉及文件

- `src-tauri/tauri.conf.json` — updater 默认 endpoints + pubkey（fallback；运行时由 `update.rs` 覆盖）
- `src-tauri/src/update.rs` — 源列表、endpoint、下载 URL 改写、`check_app_update` / `get|set_update_source`
- `src-tauri/src/lib.rs` — 启动 3 秒后按已保存源检查一次（10s 超时）
- `src-tauri/src/reminder_toast.rs` — 创建更新 Toast
- `src/views/toastWindows/ReminderToast.vue` — 更新卡片安装走 `checkAppUpdate`，并负责按卡片内容调整 Toast 窗口尺寸
- `src/components/UpdateToastCard.vue` — 更新 Toast UI；更新源选择、官网最新说明 iframe、iframe 高度消息校验与上限、加载失败回退
- `website/latest/index.html` — 官网线上最新版本说明页面
- `website/latest/preview.html` — 本地 iframe 预览页面，内容/样式确认后同步至官网页面
- `src-tauri/src/reminder_toast.rs` — 接收前端测量内容尺寸并调整 Toast 窗口
- `.github/workflows/release.yml` — `publish-tauri` 生成 latest.json，`rewrite-latest-json` 改写下载 url 为 ghproxy 前缀
- [官网版本说明页与更新弹窗改造评估.md](官网版本说明页与更新弹窗改造评估.md) — 方案风险与 iframe 设计背景（最终规则以本 README 的 latest-only 发布链路为准）

## 行为

- 应用启动 3 秒后异步检查一次；设置页可手动检查
- 更新源存 SQLite `update_source`（默认 `auto`）。自动检查、设置页、更新 Toast 共用。
- `auto` 按顺序尝试 endpoints，任一成功即用，全部失败才报错：
  1. `https://ghfast.top/https://github.com/.../releases/latest/download/latest.json`
  2. `https://gh.ddlc.top/https://github.com/...`
  3. `https://ghproxy.net/https://github.com/...`
  4. `https://github.com/...`（直连兜底）
- 锁定源（`ghfast` / `ghddlc` / `ghproxy` / `github`）只打该源；下载 URL 会剥掉 CI 的 ghproxy 前缀再按所选源重包
- `auto` 下载失败会按同一顺序换源重试安装包 URL
- 有新版本 → 右下角橙色更新 Toast；卡片不自动关；详情默认收起，点击可展开/收起
- 展开详情后显示官网 `/latest/` 的 iframe 内容；iframe 通过约定 `postMessage` 上报文档高度，客户端只接受固定官网 origin 且来源为本 iframe 的高度消息，并钳制高度上限（当前 440px）
- iframe 加载超时显示 updater body/通用兜底文案，可重试或系统浏览器打开官网说明；说明加载不影响更新安装
- 本地开发模式 iframe 加载 `website/latest/preview.html`，用于官网发布前预览；生产模式才使用 GitHub Pages `/latest/`
- 下载中有进度条；`auto` 下载走 latest.json 里的 url
- 检查失败仅日志，不阻断启动；整个生命周期只自动检查一次

## 发布链路

每次正式 release 必须**先更新官网最新说明，再更新客户端版本号并发布**：

1. 在 `website/latest/preview.html` 编写/整理最新说明，按时间线节点呈现，每节点一条简短纯文本摘要；保持节点与线对齐，不在嵌入内容中加入不必要的标题、导航或页脚。
2. 在本地调试更新提醒窗口确认内容与布局；官网页变更要先本地预览，不要先推线上再验证。
3. 确认后将同一说明内容同步到 `website/latest/index.html` 并发布官网，验证 `https://lanxiuyun.github.io/Catrace/latest/` 可访问、iframe 可嵌入且高度上报正常。
4. 官网内容就绪后再通过规定的版本管理流程更新客户端版本号，随后构建并发布桌面 release。
5. 发布后确认 updater `latest.json`、说明页和客户端版本更新提示彼此一致。说明始终展示官网当前的最新信息；这是产品约定，不按客户端目标版本回查历史说明。
6. `publish-tauri`（4 平台 matrix）构建产物 + 签名 + 生成 latest.json，上传到 Release；`rewrite-latest-json` 在所有平台构建完成后改写下载 URL 并覆盖上传。

## 关键约束

- **发布次序不可倒置：先官网 `/latest/`，再改客户端版本号并发布**，避免新客户端提示已出现但官网说明尚未就绪。
- `/latest/` 是滚动的最新内容，不做按版本号路由；客户端展示最新说明可能比当前可安装目标版本更新，符合当前产品规则。
- iframe 页面发送高度消息时使用固定消息类型；宿主必须校验 origin、`event.source` 和 payload 类型，并设置最大高度；超出上限后由 iframe 自身滚动。
- iframe 不加载时必须保留 updater body/通用提示和外链，且不得阻塞更新流程。
- 本地预览文件仅用于本地开发验证；确认内容后再同步官网线上页，避免线上与本地版本分叉。
- `rewrite-latest-json` **必须等全部平台构建完成**：各 matrix job 会陆续覆盖 latest.json，提前改写会被后续平台覆盖回直链版本（见 [竞态记录](../../bugs/2026-07-12-latest-json-rewrite-race-with-platform-builds.md)）。
- 平台构建失败时用 Actions 页面 "Re-run failed jobs"，不用整个 workflow 重跑。
- 签名 pubkey 在 `tauri.conf.json`，私钥在 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY`）。
