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
