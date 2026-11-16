# 插件的 Node 运行环境

`sidecar.command` 为裸 `node` / `node.exe` 时，宿主通过命令解析器寻找 Node，系统 Node 优先于托管便携目录。

## 宿主能力

- [node_runtime.rs](../../../src-tauri/src/node_runtime.rs) 提供 `get_node_runtime_status` / `install_node_runtime`：下载固定 LTS 到暂存目录，解压后安装到 `app_data/runtime/node/`，记录版本标记。
- Windows 下载官方 zip；macOS / Linux 下载 tar.gz 并用系统 tar 解压。不支持的 OS / arch 返回明确错误。
- 下载优先 npmmirror，失败回退 nodejs.org；通过 `node-install-progress` 报告字节进度。当前下载没有超时，主源半挂时回退可能延迟。
- [sidecar/command.rs](../../../src-tauri/src/sidecar/command.rs) 解析系统命令及托管目录；setup 注册 `runtime/node` 和 `runtime/node/bin`，便携安装不修改系统 PATH、不要求管理员权限，完成后无需重启宿主。
- 前端封装在 [tauri.ts](../../../src/api/tauri.ts)：`getNodeRuntimeStatus` / `installNodeRuntime` / `sidecarNeedsNode`。

## 界面边界

当前 React 插件中心没有调用这些 Node 检测 / 安装接口。缺少系统或便携 Node 时，依赖 Node 的插件启用会失败；不能将其描述为已有一键安装入口。

若接入安装交互，应覆盖带设置面板和无设置面板的插件，成功后重试当前插件启用，不重启其它插件或整个应用。
