# 待做：mac 包要用 Apple Developer ID 签名，更新后才能保住辅助功能授权

当前 CI 只有 Tauri updater 的 minisign，mac `.app` 是 ad-hoc 签名。TCC 认的是签名身份，不是应用名，所以**每次更新辅助功能授权都会丢**。

兜底采样（系统空闲秒数 + 光标）已经够用，主窗/设置也不再催授权。这条待做只解决「想用完整键鼠采样、且更新后不用再勾权限」。

## 要做

1. Apple Developer 账号 + **Developer ID Application** 证书（Team ID 固定）
2. Release 工作流给 `tauri-action` 配证书 / 公证（`APPLE_CERTIFICATE`、notarize），**不要**再用 `signingIdentity: "-"`
3. 签完后验证：`codesign -dv` 的 Identifier 仍是 `com.lanxiuyun.catrace`，跨版本 Authority 同一条 Developer ID
4. 签名稳定后，可以只在设置页接回授权入口；**不要**把主窗横幅挂回去

minisign 管的是 updater 包完整性，**替代不了** Apple 代码签名。

细节见 [macos-accessibility-permission.md](../../reference/macos-accessibility-permission.md)。
