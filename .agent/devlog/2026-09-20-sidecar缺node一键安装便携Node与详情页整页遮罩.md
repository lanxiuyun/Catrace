# 2026-09-20 sidecar 缺 Node 一键安装便携 Node 与详情页整页遮罩

## 会话目标

给 `sidecar.command = node` 的插件提供一键静默安装便携 Node，让没装 Node 的用户能跑 sidecar，且不要重启应用。

## 完成项

- grill-me 收敛：便携 zip、不重启、npmmirror+官方、钉死 LTS、自动识别裸 `node`、Windows x64 先行、入口贴在插件详情。
- 后端 `node_runtime.rs` + `register_managed_bin_dirs`；系统 Node 优先。
- 前端：先横幅（误放无 settings 兜底分支 → 带 settings 的插件看不见）→ 改共用位置 → 用户要求改成右侧整页遮罩只留安装卡。
- 文案：「运行时」改成「需要 Node.js 才能运行」。
- 顺带修顶栏插槽图标 scoped CSS 失效（wecom-todo 384 图标撑破布局）。
- PR #75 `feat/portable-node-runtime`（真机验证后由用户 merge）。

同日稍早：Mac 更新后辅助功能失效一直休息，PR #74 已合（免权限兜底采样 + 主窗横幅）。
