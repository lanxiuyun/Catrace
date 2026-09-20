# 2026-09-20 便携 Node 安装补上 macOS 与 Linux

## 会话目标

PR #75 原先 Windows x64 zip 先行，补上 mac/Linux 官方 tar.gz。

## 完成项

- `asset_suffix`：darwin-arm64/x64、linux-x64/arm64 → `tar.gz`；Windows 仍 zip
- Unix 用系统 `tar -xzf`，补 `bin/node` 可执行位
- 下载仍 npmmirror → nodejs.org；未设超时（海外可能卡在镜像）
- PR #75 标题/正文已更新（需 `gh auth switch -u lanxiuyun`）

## 待开发

- 下载超时或非中文环境先走官方源
- mac Developer ID 签名见 input-monitoring 待做

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `src-tauri/src/node_runtime.rs` | 多平台资源 + tar 解压 |
