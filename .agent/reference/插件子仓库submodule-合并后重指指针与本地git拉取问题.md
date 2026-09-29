# 插件子仓库（submodule）：合并后重指指针 + 本机 git 拉取问题

> 操作 `tools/plugin-demo`（catrace-plugin submodule）时踩到的两件事：**squash 合并会让宿主的指针悬空**、**本机 git 直连 github 会握手失败**。

## 1. 插件 PR 被 squash 合并后，必须把 submodule 指针重指到插件 main

### 现象

插件 PR 用 squash 合并后，宿主 PR 里 `tools/plugin-demo` 的 gitlink 仍然指着**合并前那个分支 commit**。那个 commit 不在插件仓库的 main 上，且特性分支通常会被删掉——对象失去引用，等 GitHub GC 掉之后，任何按该 SHA 拉 submodule 的操作（CI 的 `submodules: recursive`、新克隆）都会失败。

**危险之处在于它不会立刻报错**：对象还在时 CI 一路绿灯，看起来「能合并」。

### 判定

```bash
# 该 commit 是否在插件 main 上？diverged = 不在（squash/rebase 合并的特征）
gh api repos/lanxiuyun/catrace-plugin/compare/main...<gitlink-sha> --jq .status
# identical / behind = 是祖先（安全）；ahead = main 落后于它；diverged = 分叉

# 宿主 PR 当前的 gitlink
git ls-tree <pr-head> tools/plugin-demo
```

### 修法

在**有该 PR 分支检出的那个工位**里操作（指针改动要提交到 PR 分支上）：

```bash
cd <工位>/tools/plugin-demo
git fetch origin && git checkout main && git merge --ff-only origin/main   # 跟到插件 main tip
cd <工位> && git add tools/plugin-demo                                    # 只 stage 这一个
git commit -m "chore(submodule): point at catrace-plugin main (<sha>)"
git push origin <PR 分支>
```

改完核对 `git ls-tree HEAD tools/plugin-demo` 与 `gh api repos/lanxiuyun/catrace-plugin/commits/main --jq .sha` 一致。内容通常等价（squash 只换了 SHA），但目录树要顺手确认一眼：插件版本号、`background` 字段有没有、被删的文件是否真的没了。

### 顺带一提

Squash 是仓库的合并习惯，所以这件事**每次合并插件 PR 都要做一遍**；合并插件 PR 后先重指、再看宿主 PR 的 CI。

## 2. 本机 git 直连 github 握手失败（schannel）

### 现象

```
fatal: unable to access 'https://github.com/lanxiuyun/catrace-plugin.git/':
schannel: failed to receive handshake, SSL/TLS connection failed
```

间歇出现，重试几次也可能仍失败；但同一时刻 `gh api ...` 正常——因为 gh 的 API 调用走另一套 HTTP 栈，容易误判成「网络没问题」。

### 处理

Windows 上 git 默认用 schannel，换 openssl 后端即可：

```bash
git -c http.sslBackend=openssl fetch origin main
git -c http.sslBackend=openssl push origin <branch>
```

或者临时走项目已在用的镜像（`tauri.conf.json` 的更新源同款）：

```bash
git -c url."https://ghfast.top/https://github.com/lanxiuyun/catrace-plugin.git".insteadOf="https://github.com/lanxiuyun/catrace-plugin.git" fetch origin main
```

要长期生效可写进 `~/.gitconfig`（`[http] sslBackend = openssl`），但那是本机环境改动，别提交进仓库。

## 相关

- [../../AGENTS.md](../../AGENTS.md) 规则 11 — 插件仓库与 submodule 的日常流程
- `.agent/reference/worktree-testing.md` — 工位与 app_data junction（该文件在 main 上由 #85 引入）
