# 开发工作流：main 直开

> **现行约定（2026-10-02）**：**所有功能直接在主仓 `D:\workspace\Catrace`（main 分支）开发**，不再开 worktree、不再开功能分支；多个功能/任务可并行推进（含多个 agent 会话共用这个工作区）。原「一分支一工位（worktree）+ `pnpm st`」方案已停用，历史细节见 git 历史里的本文档旧版。

## 起 dev

```bash
pnpm tauri dev
```

```bash
git submodule update --init --recursive   # submodule 未对齐时（缺了会 sync 出 0 个插件）
node scripts/sync-plugins.mjs             # 仅首次 / src-tauri/.bundled-plugins 缺失时
pnpm tauri dev
```

- `beforeDevCommand` 只是 `pnpm dev`（vite），**不会**跑 sync-plugins；tauri-build 编译期校验 `src-tauri/.bundled-plugins`，缺失时报 `resource path '.bundled-plugins' doesn't exist`，`pnpm tauri dev` 和 `cargo build` 都起不来（全新目录必然撞上，跑一次 sync 即生成）。debug 下插件走 junction 挂 app_data，这个目录只需存在、内容对 dev 无作用
- submodule 漂移判据：`git submodule status` 行首 `+` = 指针漂移、`-` = 未初始化；一律 `git submodule update --init --recursive` 对齐（对象已在本地时不联网）
- ⚠️ 入口不能叫 `pnpm dev`：它是 vite，且 `tauri.conf.json` 的 `beforeDevCommand` 就是 `pnpm dev`，挂上去会递归调用自己
- **同一时刻只能跑一个 dev 实例**：单实例插件是无条件注册的（`src-tauri/src/lib.rs`，没有 debug 门），第二个实例启动即退出、把事件转给第一个；且所有构建共用同一份 app_data（`%APPDATA%\com.lanxiuyun.catrace`）。要看另一个改动，先停掉当前 dev
- dev 与正式安装的 Catrace 共用 app_data，测试前先从托盘退出正式版，避免单实例互相干扰

## 坑：改插件会把 dev server 打死（Vite watcher EBUSY）

**症状**：每次在 `tools/plugin-demo/` 下写文件（尤其连续改几个文件），`pnpm tauri dev` 突然整体退出：

```
Error: EBUSY: resource busy or locked, watch '...\tools\plugin-demo\dsh-chat\runtime\lib\
  .gui-proxy.mjs.<pid>.<uuid>.tmpdir\gui-proxy.mjs.tmp'
    at FSWatcher.<computed> (node:fs:watchers) ← createFsWatchInstance ← vite .../_watchWithNodeFs
[ELIFECYCLE] Command failed with exit code 1.  Error The "beforeDevCommand" terminated with a non-zero status code.
```

**根因**（**与 `beforeDevCommand` 内容、与 worktree/station 都无关**）：`beforeDevCommand` 一直是 `pnpm dev`（vite）；
而 `vite.config.ts` 的 `server.watch.ignored` **只排除了 `src-tauri`**，于是 Vite 的 chokidar 把
`tools/plugin-demo/` 也纳入监视（实测：43 个目录 / 221 个条目）。编辑器/工具有序写入会在**同目录**建
`.xxx.tmpdir/` 临时文件再 rename，chokidar 把新目录/新文件加进 `fs.watch` 的瞬间撞上 rename/占用 → `EBUSY`；
这个 error 事件在 Vite 里没人接 → **进程直接退出** → tauri 判定 `beforeDevCommand` 失败 → 连带 App 一起关。

**修法**（已落在 `vite.config.ts`）：把不参与前端构建的目录整片排除

```ts
watch: {
  ignored: [
    "**/src-tauri/**",
    "**/tools/plugin-demo/**",  // 插件源码不参与前端构建，宿主运行时按需读文件
    "**/*.tmpdir/**", "**/*.tmpdir",
    "**/e2e-temp/**",
  ],
}
```

**验证口径**（不依赖复现那个竞态）：用 `createServer()` 起一份、等 chokidar 初扫完，看 `server.watcher.getWatched()`：
修前命中 `tools/plugin-demo` 43 个目录 / 221 条目，修后 **0**（监视目录总数 139 → 90）。
脚本留在 `e2e-temp/watch-set-check.mjs`（对照用未修复配置 `e2e-temp/vite-nofix.config.ts`）。

> 注：`pnpm station` / `pnpm st` / `scripts/dev-station.mjs`（worktree 工位时代的启动器）**已删除**（2026-10-03）。
> `src-tauri/src/plugins.rs` 里的 dev-link 重指向 / prune 逻辑**保留**——它当年为工位而写，但作用不止工位
> （仓库搬家、重新 clone、插件移出子仓时都靠它清理幽灵链接），只是注释里的"工位"字样已中性化。

## 并行开发守则

所有任务共用一个工作区，未提交改动会混在一起，所以：

- 动手前先 `git status` 认清工作区里已有什么；不动不属于自己任务的未提交改动
- 提交时（用户点名才提交，规则 14）只 `git add` 自己任务动过的文件，**不要 `git add -A` / `git add .`**
- 不做切分支 / checkout / stash——未提交改动跟着工作区走，这些操作会波及并行任务的改动
- debug 构建把插件 junction 进 `app_data/plugins/`，源路径是编译期的 `CARGO_MANIFEST_DIR`（主仓）；只剩一个检出后，「junction 钉在别的工位」一类问题不再出现

## 遗留 worktree 清理（需要时）

2026-10-02 之前按「一分支一工位」建过的工位还在磁盘上（如 `D:\workspace\Catrace-log-devtools`、`Catrace-codex-jump`、`Catrace-toast-scroll`）。清理步骤（含 submodule 时 `git worktree remove` 会直接拒）：

```bash
git worktree remove <工位路径>      # 拒就先 git -C <工位> submodule deinit --all，再不行 rm -rf + prune
git worktree prune
git branch -d <分支>                # squash 合并过的分支会拒：diff main 确认内容后改用 -D
```

注意工位里可能有未入库的本地文件（`e2e-temp/` 临时脚本等），删前先扫一眼。

## 环境坑（仍然适用）

| 坑 | 处理 |
|----|------|
| `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS: esbuild` | pnpm 11 下 `onlyBuiltDependencies` 已失效，`pnpm-workspace.yaml` 补 `allowBuilds:\n  esbuild: true`；pnpm 失败时写回的 `set this to true or false` 脚手架行同理改成 `true` |
| `src-tauri/target/debug/incremental` 无限膨胀（实测 39 G） | 纯增量编译缓存，`rm -rf src-tauri/target/debug/incremental` 立省，cargo 会重建；根治就起 dev 时 `CARGO_INCREMENTAL=0` |
| `tools/plugin-demo` 只剩一个 `.git` 指针（clone 中断残留），`submodule update --init` 报 `Unable to find current revision` | `rm -rf tools/plugin-demo` 后重跑 `git submodule update --init --recursive`（目录里只有 `.git` 才能这么干） |
| CRLF 幻影脏文件（`git status` 有 `M` 但 diff 为空） | `git checkout -- <file>` 或 `git update-index --refresh` 清掉 |

## dev-station 脚本（停用）

`scripts/dev-station.mjs`（`pnpm st` / `pnpm station`）随 worktree 方案一起停用，代码保留在仓库里。单工位下它仍能跑（列出主仓、自动补 submodule / 依赖后起 dev），但不再是标准流程——文档与给用户的命令一律写 `pnpm tauri dev`。
