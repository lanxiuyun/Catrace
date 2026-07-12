# 2026-07-12 latest.json 改写与平台构建的竞态

## 症状

Windows 客户端点「立即更新」后下载不动，console 报 `error sending request for url (https://github.com/...)`。检查发现线上 latest.json 里只有最早构建完的 darwin-x86_64 是 ghproxy 代理链接，其余 6 个平台仍是 GitHub 直链。

## 根因

`tauri-action` 的 4 个平台 matrix job **陆续**上传产物并覆盖更新 latest.json（不是一次性写全）。当时 `rewrite-latest-json` 被改成"latest.json 一出现就改写"（为支持单独重跑而移除了 `needs: publish-tauri`），于是它在只有 darwin-x86_64 一个平台时就下载改写并上传，之后 3 个平台构建完成又把 latest.json 覆盖回直链版本。

## 修复

`rewrite-latest-json` 改回 `needs: publish-tauri`，等 4 个平台全部构建完成后再下载 → sed 改写 → 覆盖上传。

## 教训

- Release 附件在 matrix 构建期间是**动态变化**的，任何依赖其内容的下游 job 必须等全部 matrix 完成
- "单独重跑"诉求由 Actions 页面 "Re-run failed jobs" 满足即可，不需要为此解耦 job 依赖
