# 版本号管理

**只走 CLI**，禁止手改单个文件：

```bash
pnpm version:set 26.8.26
```

脚本：`scripts/set-version.mjs`（`package.json` → `version:set`）。一次写入下列文件，二进制替换，不改换行 / BOM：

| 文件 | 读取方 |
|------|--------|
| `package.json` → `"version"` | GitHub Actions workflow（发布 & updater URL） |
| `src-tauri/tauri.conf.json` → `version` | Tauri 运行时、应用元信息 |
| `src-tauri/Cargo.toml` → `[package] version` | Rust 编译、产物文件名 |
| `src-tauri/Cargo.lock` → `name = "catrace"` 的 `version` | Cargo 锁文件与 crate 版本对齐 |

漏改任一文件会导致 CI 发布错误版本、updater 指向旧版本，或留下脏的 `Cargo.lock`。

## Catrace 正式版发布流程（必须按顺序）

正式发布包含宿主与内置插件的 Catrace 版本时，**先在 `main` 完成版本更新，再把 `main` 合入 `release`**。`release` 分支是发布触发器，不是版本开发分支。

1. 在 `main` 分支运行 `pnpm version:set <新版本>`，让 CLI 同步更新上表的四个版本文件。
2. 检查差异，提交版本更新（中文、用户可读的发布说明标题），然后 `git push origin main`。
3. 切换到 `release`，先同步远端，再将 `main` 合并进 `release`，然后 `git push origin release`。
4. 推送 `release` 会触发现有 `.github/workflows/release.yml`；等待 Actions 完成多平台构建与 Release 资产上传，再核对 tag、资产和 `latest.json`。

### 禁止事项与原因

- **不得在 `release` 上直接改版本号或单独制作一个版本提交。** 版本事实先落在 `main`，再由合并带入 `release`，避免两分支版本提交分叉、后续主线丢失发布版本，或发布内容和主线代码不一致。
- 不要为发布流程重写、强推或手工移动分支历史；正常合并即可。
- 不能只看到 Release 草稿/tag 已创建就认为发布完成；需等多平台工作流成功并核对最终资产与 updater 清单。

一句话记忆：**main 更新版本 → commit → push；release 合并 main → push；由工作流发布。**
