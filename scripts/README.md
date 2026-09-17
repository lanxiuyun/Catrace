# Catrace Dev 源码启动器

这两个 VBS 脚本用于 Windows 上双击启动源码版 Catrace，不会打开黑色 console 窗口。

## 首次设置开始菜单入口

双击：

```text
scripts/install-catrace-dev-shortcut.vbs
```

脚本会在当前用户开始菜单的 `Programs` 下创建：

```text
Catrace Dev.lnk
```

快捷方式使用仓库里的 `src-tauri/icons/icon.ico`，不会覆盖正式安装版的 `catrace.lnk`。

## 日常启动

之后从 Windows 开始菜单搜索并运行：

```text
Catrace Dev
```

它会自动把当前仓库根目录设为 working directory，并后台执行：

```text
pnpm tauri dev
```

Tauri 窗口正常显示，pnpm/Vite/Cargo 的 console 不显示。

## 前置条件

本机仍需安装并配置：

- Node.js
- pnpm
- Rust/Cargo
- Tauri 所需 Windows build tools

这个入口运行的是源码开发版，不是 release 安装版。修改源码后按现有 dev 流程重新加载即可。

## 停止开发版

直接关闭 Catrace 窗口通常会结束对应 dev 进程；如果终端进程仍残留，可在任务管理器中结束对应的 `cargo`/`catrace` 开发进程。

该脚本不会注册开机自启，也不会修改正式版的安装快捷方式。
