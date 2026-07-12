# 自动更新检查

基于 Tauri 官方 `tauri-plugin-updater`（v2.10.1），latest.json 托管在 GitHub Release，国内通过 ghproxy 类镜像加速。

## 涉及文件

- `src-tauri/tauri.conf.json` — updater endpoint（代理优先的 3 个 fallback）+ pubkey
- `src-tauri/src/lib.rs` — 启动 3 秒后异步检查一次（10s 超时）
- `src-tauri/src/reminder_toast.rs` — 创建更新 Toast
- `src/views/ReminderToast.vue` — 更新卡片 UI（check 带 10s 超时）
- `src/components/settings/SystemSettingsCard.vue` — 设置页手动检查 / 安装（check 带 10s 超时）
- `.github/workflows/release.yml` — `publish-tauri` 生成 latest.json，`rewrite-latest-json` 改写下载 url 为 ghproxy 前缀

## 行为

- 应用启动 3 秒后异步检查一次；设置页可手动检查
- 插件按顺序尝试 endpoints，任一成功即用，全部失败才报错：
  1. `https://ghfast.top/https://github.com/.../releases/latest/download/latest.json`
  2. `https://gh.ddlc.top/https://github.com/...`（备用镜像）
  3. `https://github.com/...`（直连兜底）
- 有新版本 → 右下角橙色更新 Toast；卡片不自动关，含「查看详情」（展开 changelog）和「立即更新」（下载+安装+重启）
- 下载中有进度条；安装包下载走 latest.json 里的 url（CI 已改写为 ghproxy 前缀）
- 检查失败仅日志，不阻断启动；整个生命周期只自动检查一次

## 发布链路

1. `publish-tauri`（4 平台 matrix）构建产物 + 签名 + 生成 latest.json，上传到 Release
2. `rewrite-latest-json`（`needs: publish-tauri`）下载 latest.json，用 sed 把 `"url": "https://github.com/` 替换为 `"url": "https://ghproxy.net/https://github.com/`，覆盖上传
3. 客户端检查更新走镜像拿 latest.json，按其中 url 下载安装包并校验签名

## 关键约束

- `rewrite-latest-json` **必须等全部平台构建完成**：各 matrix job 会陆续覆盖 latest.json，提前改写会被后续平台覆盖回直链版本（见 [bugs/2026-07-12](../bugs/2026-07-12-latest-json-rewrite-race-with-platform-builds.md)）
- 平台构建失败时用 Actions 页面 "Re-run failed jobs"，不用整个 workflow 重跑
- 签名 pubkey 在 `tauri.conf.json`，私钥在 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY`）
