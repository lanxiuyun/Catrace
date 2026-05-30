# 版本号管理

**🔴 强约束**：修改版本号时，以下 3 个文件**必须同步更新**，缺一不可：

| 文件 | 读取方 |
|------|--------|
| `src-tauri/tauri.conf.json` → `version` | Tauri 运行时、应用元信息 |
| `package.json` → `"version"` | GitHub Actions workflow（发布 & updater URL） |
| `src-tauri/Cargo.toml` → `[package] version` | Rust 编译、产物文件名 |

> 禁止只改其中一个文件。漏改任一文件会导致 CI 发布错误版本或 updater 指向旧版本。
