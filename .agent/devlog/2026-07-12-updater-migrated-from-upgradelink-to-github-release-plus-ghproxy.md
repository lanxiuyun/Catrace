# 2026-07-12 更新通道从 upgradelink 迁移到 GitHub Release + ghproxy 镜像

## Session goal

upgradelink（toolsetlink）停止服务，需要替换软件更新通道；并解决国内用户检查更新转圈、下载不动的问题。

## Completed

- updater endpoint 改为 GitHub Release 静态 JSON（官方 Static JSON 模式），删除 upgradelink 相关配置与鉴权头
- 国内可达性：endpoints 代理优先（ghfast.top → gh.ddlc.top → GitHub 直连），check 全部加 10s 超时
- CI 新增 `rewrite-latest-json`：构建完成后把 latest.json 下载 url 改写为 ghproxy 前缀
- 修复 rewrite job 与平台 matrix 构建的竞态（见 bugs/2026-07-12）
- report.rs 业务代码清空（保留 `spawn_report_app_start` 空接口），移除 `md5`、`semver` 依赖
- 关闭 `dangerousInsecureTransportProtocol` / `dangerousAcceptInvalidCerts`

## Remaining

- GitHub Secrets 里的 `UPGRADE_LINK_*` 可手动清理
- report 上报接口等后续接入新服务后填充

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.json` | endpoint 3 个代理 fallback；删除 dangerous 开关 |
| `src-tauri/src/lib.rs` | 移除 X-AccessKey；check 加 10s timeout |
| `src/views/ReminderToast.vue` | 移除 X-AccessKey；check 加 10s timeout |
| `src/components/settings/SystemSettingsCard.vue` | 同上（两处 check） |
| `src-tauri/src/report.rs` | 清空 toolsetlink 业务，留空接口 |
| `src-tauri/Cargo.toml` | 移除 md5、semver |
| `.github/workflows/release.yml` | 删 upgradeLink-upload；加 rewrite-latest-json |
