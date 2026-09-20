# sidecar 缺 Node 时一键安装便携 Node

插件 `sidecar.command` 为裸 `node` / `node.exe`、且本机解析不到 Node 时：右侧详情页整页遮罩，只留安装卡。装完不重启应用，下次 sidecar 拉起即命中便携目录。

## 现行行为

1. 检测：`sidecarNeedsNode(sidecar)`（前端）+ `get_node_runtime_status`（后端 `find_program("node")`）。系统 PATH / 常见安装目录命中则横幅不出现，**系统 Node 恒定优先**。
2. UI：`Plugins.vue` 在 `.plugin-main` 上盖 `.node-runtime-gate`（模糊 + 灰度背景，拦截点击）。左侧插件列表仍可切换。装完遮罩消失，已启用插件走 `onToggleExternal(id, true)` 重同步 sidecar。
3. 安装：下载钉死的 LTS（当前 `v22.20.0`）→ 解压到暂存目录 → 原子换入 `app_data/runtime/node/` → 写 `.catrace-node` 版本标记。Windows 用官方 zip；macOS / Linux 用官方 `tar.gz`，系统 `tar -xzf` 解压（不新增 crate）。布局：Windows 根目录 `node.exe`，Unix `bin/node`（setup 同时注册 `runtime/node` 与 `runtime/node/bin`）。其它 OS/arch 返回 `node_runtime_platform_unsupported`。
4. 下载源：npmmirror 主源，失败切 nodejs.org。进度事件 `node-install-progress`（`{ received, total }`）。`reqwest::get` **没有超时**：镜像若对海外半挂死，不会马上失败，官方备源要等镜像自己报错才会上场。解压全在本机，与地区无关。
5. 解析：setup 里 `register_managed_bin_dirs([runtime/node, runtime/node/bin])`，`resolve_program` / 子进程 PATH 都包含。装完**不必重启 exe**。

用户文案说「需要 Node.js 才能运行」，不要写「运行时」「未检测到」。

## 涉及文件

- `src-tauri/src/node_runtime.rs` — 状态 / 下载 / 解压 / 进度
- `src-tauri/src/sidecar/command.rs` — `find_program`、`register_managed_bin_dirs`
- `src-tauri/src/lib.rs` — setup 注册托管目录；两个 invoke 命令
- `src/views/mainWindow/Plugins.vue` — 整页 gate
- `src/api/tauri.ts` — `getNodeRuntimeStatus` / `installNodeRuntime` / `sidecarNeedsNode`
- `src/i18n/locales/zh-CN.ts` / `en-US.ts` — `plugins.nodeRuntime.*`

## 为什么必须这样

- 系统 MSI / winget 要 UAC，不算静默；便携 zip 免管理员、卸载即删目录。
- 横幅不能塞进「无 settings.mjs」的兜底分支：带 `settings.mjs` 的插件（PasteDrop、agent-notify、wecom-todo）走 `ActiveDetail`，永远看不到。缺 Node 时插件内容必然报 `sidecar is not running`，所以改成**整页遮罩**，不让用户操作一个必失败的面板。
- 不加 manifest `requires: ["node"]`：现有 `command: "node"` 已经足够识别。

## 不要做

- 不要为装 Node 重启宿主。
- 不要改系统 PATH、不要装系统级 Node。
- 不要在用户文案里写「运行时」。
- 不要把安装入口做成独立「运行时管理」页。
- 不要假设国外用户总能秒切 nodejs.org；要稳需给下载加超时，或非中文环境先走官方源（尚未做）。

反复测试：删 `app_data/runtime/node` 后刷新插件页，gate 会再出现。
