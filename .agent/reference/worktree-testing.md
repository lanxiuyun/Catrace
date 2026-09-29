# 开发环境：一分支一工位（worktree）

> **现行约定（2026-09-28）**：**同时在飞的每个分支各占一个 worktree 工位**，改代码和跑 dev 都在它自己的工位里做，互不干扰；`D:\workspace\Catrace` 常驻 main。换工位**不用 cd**：从任意目录 `pnpm -C <工位路径> tauri dev`。只有"单功能串行"时才在主工位就地切分支。

## 工位清单

| 工位 | 当前分支 | 说明 |
|------|----------|------|
| `D:\workspace\Catrace` | main | 主工位，常驻基线 |
| `D:\workspace\Catrace-lab` | detached（闲置） | 空闲槽位：要开第三个分支时 `git switch <branch>` 用它 |
| `D:\workspace\Catrace-notif` | feat/win-notification-forward | 通知转发需求的工位 |

新建工位：

```bash
git worktree add D:\workspace\Catrace-<name> -b feat/<name> main   # 新需求
git worktree add D:\workspace\Catrace-82 82-轻量模式                # 拿现成分支
```

新工位要跑一遍下面的「初始化三件套」。

## 起 dev 不用 cd

```bash
pnpm station            # 交互选择工位（↑↓ / j k 移动，Enter 启动，q / Esc 取消）
pnpm station notif      # 直接在 notif 工位起（工位名 = 目录名去掉 Catrace- 前缀，或分支名）
pnpm station --dry-run  # 只看工位状态，不启动
pnpm station --plain    # 不交互，静态打印工位列表
```

实现在 `scripts/dev-station.mjs`（package.json 的 `station`）：工位列表实时取自 `git worktree list`，新建 worktree 自动出现。起之前会：**自动补/对齐 submodule**（空目录或指针漂移都会处理，否则 dev 会 sync 出 0 个插件或加载错版本）、提示该工位**要不要先编译**（`需冷编译` = 从没编过，几分钟 + 1~2G；`待重编` = exe 与当前 HEAD/源码对不上，启动前会增量编一会儿）、提示 **1420 已被占用**（已有 dev 在跑，新实例会被单实例插件杀掉）。

## 插件来源与 app_data 链接（dev-link）

**每个工位有自己的 `tools/plugin-demo` 检出**（独立 git dir，互不影响）。它必须与该分支记录的 submodule 指针一致：`git submodule status` 行首是 `+` 就是漂移（切分支、在别的工位跑过 `submodule update` 都会造成），行首是 `-` 是没初始化 —— `pnpm station` 起之前会自动对齐。

debug 构建启动时，宿主会把每个插件 junction 进 `app_data/plugins/`，源路径是**编译期**的 `CARGO_MANIFEST_DIR`，也就是"编出这个 exe 的那个工位"。

> **2026-09-29 修复**：旧实现遇到已存在的链接直接跳过（日志 `dev link ok: <name> already linked`），于是插件源会永久钉在"第一次建链接的那个工位"——实测症状是"从 lab 工位起 dev，加载的却是主工位的 0.1.1 旧插件，插件后台 WebView 不消失"。现在改成：**是链接（junction/symlink）就重指向当前工位，是真目录（用户自装插件）才跳过**，并会清掉指向别的 checkout 的陈旧链接；日志里对应 `dev link re-pointed:` / `dev link pruned:`。改动生效需要重新编译该工位的 exe。

底层就是 `pnpm -C`：`pnpm -C D:\workspace\Catrace-notif tauri dev` 效果相同（实测 cwd 确实会切过去），在任何目录敲都行。一个工位改到一半（脏着、没 commit）不影响另一个工位 —— 这正是"半成品不落盘也能看 B"的实现方式。

⚠️ 入口不能叫 `pnpm dev`：它现在是 vite，且 `tauri.conf.json` 的 `beforeDevCommand` 就是 `pnpm dev`，挂上去会递归调用自己。

只看代码、不起 app：

```bash
git -C D:\workspace\Catrace-notif diff main...feat/win-notification-forward
git -C D:\workspace\Catrace-notif log --oneline main..HEAD
```

## 硬约束：同一时刻只能跑一个 dev 实例

- 单实例插件是**无条件**注册的（`src-tauri/src/lib.rs:853`，没有 debug 门）：第二个实例启动即退出，把事件转给第一个。
- 所有工位共用同一份 app_data：`%APPDATA%\com.lanxiuyun.catrace`（`catrace.db` / `settings.json` / `window-state.json` / `plugins` junction 都是一份）。
- 所以"去看另一个分支"之前，先把当前跑着的 dev 停掉；只是写代码的对话不需要开着 dev。
- 真要两个 dev 并行，得给各自工位覆盖 `identifier` + vite 端口 + `devUrl`（`pnpm tauri dev --config ...`），目前不需要。

## 新工位初始化三件套

```bash
git -C <工位> submodule update --init --recursive   # 缺了会 sync 出 0 个插件
pnpm -C <工位> install                              # pnpm 11 需先补 allowBuilds（见下表）
pnpm -C <工位> tauri dev                            # beforeDevCommand 自动跑 sync-plugins
```

直接 `cargo build` 不会跑 sync-plugins，会报 `resource path '.bundled-plugins' doesn't exist`。

## 单功能串行时：主工位就地切分支

不并行的单功能不需要开工位：主工位 `git switch <branch>` → `pnpm tauri dev`。切之前把工作区收拾干净（commit 或 stash）——**未提交的改动跟着文件夹走、不跟分支走**，会被带到下一个分支上；目标分支动了同一个文件时 `git switch` 会被直接拒。

## 环境坑（pnpm 11.3 实测）

| 坑 | 处理 |
|----|------|
| `git worktree move` 后 cargo build 报 `failed to read plugin permissions ... \\?\旧路径\...\permissions\*.toml` | target 里缓存的 tauri build 产物记录了旧绝对路径，**清掉 `src-tauri/target` 重编**；给 worktree 改名尽量在首次编译前做 |
| 全新目录 `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS: esbuild` | `pnpm-workspace.yaml` 的 `onlyBuiltDependencies: [esbuild]` 在 pnpm 11 已失效，补 `allowBuilds:\n  esbuild: true`。这是仓库级修复（待提交）；lab 里目前以未提交 + `git update-index --skip-worktree pnpm-workspace.yaml` 常驻，上游改此文件前先 `--no-skip-worktree` |
| pnpm 失败时自动把 `allowBuilds:\n  esbuild: set this to true or false` 脚手架写回 pnpm-workspace.yaml | 把那行改成 `esbuild: true` 即可 |
| `git worktree move` / 改名后，任何 pnpm 命令都想 purge node_modules | 状态标记记的是旧路径。先 `CI=true pnpm install` 重连（约 10s，store 全是硬链接） |
| worktree 里偶发 CRLF 幻影脏文件（如 `src-tauri/Cargo.toml` 空 diff） | `git checkout -- <file>` 即清 |
| **禁止** junction 主工作区 node_modules 到 worktree | pnpm 运行前依赖检查发现状态不匹配会要求 purge，junction 指向主工作区有误删风险；`.npmrc` 写 `verify-deps-before-run=false` 无效（pnpm 11 只有 install/warn/error/prompt，没有 off） |
| 新 worktree 的 `tools/plugin-demo` 是空的 | `git submodule update --init --recursive`（同规则 11）；`pnpm station` 会自动补 |
| `tools/plugin-demo` 里只剩一个 `.git` 指针（clone 失败/中断的残留），`submodule update --init` 报 `Unable to find current revision` | `rm -rf tools/plugin-demo` 后重跑 `submodule update --init --recursive`（目录里只有 `.git` 才能这么干） |
| **`src-tauri/target/debug/incremental` 会无限膨胀** —— 主工位实测 **39 G**（`deps` 28 G、`build` 5.2 G、release 2.2 G） | 它是纯增量编译缓存，`rm -rf src-tauri/target/debug/incremental` 立省，cargo 会重建；要根治就在起 dev 时 `CARGO_INCREMENTAL=0`。工位越多、切分支越勤，涨得越快 |

## 就地切分支特有的坑

| 现象 | 原因 / 处理 |
|------|------|
| `git switch` 报 `Your local changes to the following files would be overwritten` | 该文件在目标分支里内容不同，而本地有未提交改动。先 commit / stash，或 `git checkout -- <file>` 丢弃 |
| `git switch` 报 `'<branch>' is already used by worktree at '<path>'` | 分支被某个工位占着。要么在那个工位里用（推荐），要么 `git -C <工位> switch --detach` 释放 |
| 切完 `git status` 显示 ` M tools/plugin-demo` | submodule 工作区**不跟着主仓切分支**，还停在旧分支记录的 commit。`git submodule update --init --recursive` 对齐（对象已在本地时不联网） |
| 切完出现 CRLF 幻影（如 `src-tauri/Cargo.toml` 空 diff） | `git checkout -- <file>` 或 `git update-index --refresh` 清掉 |

## 测试流程

1. 托盘退出正式安装的 Catrace —— dev 与正式版共用同一份 app_data，单实例插件互相干扰
2. 在目标工位起 dev：`pnpm -C <工位> tauri dev`（首次冷编译几分钟，之后增量）
3. 按具体 bug 复现；Toast 定位类问题看日志 `fit:` 行（`y + height` 应恒等于 work_area 底）
4. 同主工作区规则：不自动起 dev server（AGENTS.md 规则 3），验证走 Playwright 连已运行的 dev（规则 8）

## 备选工作流

| 方案 | 适用 | 说明 |
|------|------|------|
| **一分支一工位（现行）** | 多个需求并行 | 各工位独立，改 / 验都在自己工位里；每份约 1.5G（node_modules ≈240M + target ≈1.3G） |
| 主工位就地切分支 | 单功能串行 | 零额外磁盘；切走前必须 commit / stash |
| 共享 `CARGO_TARGET_DIR` | 多工位并存省盘 | worktree 放不进 git 的 `.cargo/config.toml` 指向共享 target 目录；跨分支依赖指纹相同直接命中，只重编叶子 crate；**并行构建会在同一把 target 锁上排队**，要同时跑就别共享 |
| 纯前端零编译 | 只改 `.vue` / `.ts` | 一个工位复用另一个人编好的 dev exe：`pnpm tauri dev --config '{"build":{"beforeDevCommand":"","devUrl":"http://localhost:1420"}}'`（清空 beforeDevCommand 防起第二份 vite） |
