# 自动更新检查

基于 Tauri 官方 `tauri-plugin-updater`（v2.10.1），latest.json 托管在 GitHub Release。用户可换源：自动依次尝试镜像，或锁定某一个。更新弹窗的可读说明由官网 `/latest/` 页面提供，官网版本说明是**累积时间线**：每个版本一个节点，最新版本在最上方，历史节点保留。

## 涉及文件

- `src-tauri/tauri.conf.json` — updater 默认 endpoints + pubkey（fallback；运行时由 `update.rs` 覆盖）
- `src-tauri/src/update.rs` — 源列表、endpoint、下载 URL 改写、`check_app_update` / `get|set_update_source`
- [useAppUpdateCheck.ts](../../../src/app/useAppUpdateCheck.ts) — 主窗启动 3 秒后按已保存源检查一次（10s 超时），结果只写前端更新状态
- `src-tauri/src/lib.rs` — 自动检查已移到主窗前端，不再创建更新 Toast
- `src-tauri/src/reminder_toast.rs` — 创建更新 Toast（当前停用，保留实现便于恢复）
- [controller.ts](../../../src/app/windows/toast/controller.ts) — 更新安装走 `checkAppUpdate`，[windowResize.ts](../../../src/app/windows/toast/windowResize.ts) 跟随卡片测量尺寸
- `src/components/UpdateToastCard.tsx` — 更新 Toast UI；更新源选择、官网最新说明 iframe、iframe 高度消息校验与上限、加载失败回退
- `website/latest/index.html` — 官网线上版本说明页（累积时间线，最新版本节点置顶，历史节点保留）
- `website/latest/preview.html` — 本地 iframe 预览页面，内容/样式确认后同步至官网页面
- `src-tauri/src/reminder_toast.rs` — 接收前端测量内容尺寸并调整 Toast 窗口
- `.github/workflows/release.yml` — `publish-tauri` 生成 latest.json，`rewrite-latest-json` 改写下载 url 为 ghproxy 前缀
- [官网版本说明页与更新弹窗改造评估.md](官网版本说明页与更新弹窗改造评估.md) — 方案风险与 iframe 设计背景（最终规则以本 README 的「发布链路」为准）

## 行为

- 主窗启动 3 秒后异步检查一次；设置页可手动检查
- 更新源存 SQLite `update_source`（默认 `auto`）。自动检查与设置页手动检查共用；更新 Toast 恢复时也共用。
- `auto` 按顺序尝试 endpoints，任一成功即用，全部失败才报错：
  1. `https://ghfast.top/https://github.com/.../releases/latest/download/latest.json`
  2. `https://gh.ddlc.top/https://github.com/...`
  3. `https://ghproxy.net/https://github.com/...`
  4. `https://github.com/...`（直连兜底）
- 锁定源（`ghfast` / `ghddlc` / `ghproxy` / `github`）只打该源；下载 URL 会剥掉 CI 的 ghproxy 前缀再按所选源重包
- `auto` 下载失败会按同一顺序换源重试安装包 URL
- 自动检查发现新版本时只写前端状态：左侧「设置」图标右下角显示红点，设置页「软件版本」行显示「当前版本 → 新版本」，并在下方展开更新面板（版本说明、更新源、立即更新）；**不再弹出右下角更新 Toast**
- 更新 Toast 卡片（UpdateToastCard / toast 窗口高度跟随）与 `reminder_toast::create_update_toast_window` 暂时停用、代码保留；恢复时把创建调用重新接回自动检查即可。其 iframe 高度上报、超时回退和 `website/latest/` 滚动条样式说明仍适用于该卡片
- 下载中有进度条；`auto` 下载走 latest.json 里的 url
- 检查失败仅日志，不阻断启动；主窗每次加载后自动检查一次（轻量模式重新打开主窗也会检查）

## 发布链路

每次正式 release 必须**先更新官网最新说明，再更新客户端版本号并发布**：

1. 在 `website/latest/preview.html` 的时间线**最上方新增一个节点**，已有历史节点原样保留，不覆盖、不合并、不删除：
   - 节点第一行固定为 `版本号 + " - " + 一句改动摘要。`，版本号取本次发布版本（`pnpm version:set` 设置的 `x.y.z`，与更新卡片头部一致），例如 `26.10.15 - 提醒卡片首次弹出即可显示在最前。`；不要用日期。
   - **标题里不写发版公告**：版本号已经放在首行，后面直接接改动摘要，不要写成「发布 Catrace 26.10.15，提醒卡片……」这类句子。说明页只讲用户获得了什么。
   - 同一节点下方用纯文本列表逐行列出**属于本次发布**的具体改动；一个功能/改进一行，简洁、用户可读。属于更早版本的条目留在它自己的历史节点，不要在最新节点重复。
   - 版本号与摘要使用与正文相同的字体、字号和行高，与时间线圆点垂直对齐。
   - 不显示方括号、独立版本号标题、额外“更新日志”标题、导航或页脚；时间线圆点只标记版本节点，不要把每个更新点拆成时间线节点。
   - 节点模板（直接复制后替换内容，记住把新节点插在 `<ol class="timeline">` 的第一项）：

     ```html
     <li class="item">
       <div class="time">26.10.15 - 提醒卡片首次弹出即可显示在最前。</div>
       <ul class="details">
         <li>修复重启后第一次出现的提醒小窗被其它置顶窗口遮挡的问题，不必再手动点击恢复。</li>
         <li>提醒小窗只在首次显示时调整一次层级，后续提醒不反复推高窗口，减少对全屏游戏的影响。</li>
       </ul>
     </li>
     ```
2. 本地用浏览器打开 `website/latest/preview.html`，确认节点、摘要、详细条目和对齐；官网页变更先本地预览，不要先推线上再验证。更新 Toast 停用期间客户端不再内嵌该页，恢复后再按原流程在提醒窗口里验证高度。
3. 确认后将同一内容和结构同步到 `website/latest/index.html` 并发布官网，验证 `https://lanxiuyun.github.io/Catrace/latest/` 可访问、iframe 可嵌入且高度上报正常。
4. 官网内容就绪后再通过规定的版本管理流程更新客户端版本号，随后构建并发布桌面 release。
5. 发布后确认 updater `latest.json`、说明页和客户端版本更新提示彼此一致。说明页是累积时间线，顶部节点对应当前最新发布，历史节点保留供回看；不按客户端目标版本路由。
6. `publish-tauri`（4 平台 matrix）构建产物 + 签名 + 生成 latest.json，上传到 Release；`rewrite-latest-json` 在所有平台构建完成后改写下载 URL 并覆盖上传。

## 关键约束

- **发布次序不可倒置：先官网 `/latest/`，再改客户端版本号并发布**，避免新客户端提示已出现但官网说明尚未就绪。
- **时间线只增不删**：每次发版在最上方插一条新节点，旧节点内容不改、不合并、不删除；已经发布出去的历史说明对用户可见，改动它等于改写历史。
- `/latest/` 是累积时间线，不做按版本号路由；客户端展示的说明可能比当前可安装目标版本更新，符合当前产品规则。
- iframe 页面发送高度消息时使用固定消息类型；宿主必须校验 origin、`event.source` 和 payload 类型，并设置最大高度；超出上限后由 iframe 自身滚动，滚动条样式必须写在 `website/latest/` 页面里（宿主 CSS 作用不到 iframe 文档）。
- iframe 不加载时必须保留 updater body/通用提示和外链，且不得阻塞更新流程。
- 本地预览文件仅用于本地开发验证；确认内容后再同步官网线上页，避免线上与本地版本分叉。
- `rewrite-latest-json` **必须等全部平台构建完成**：各 matrix job 会陆续覆盖 latest.json，提前改写会被后续平台覆盖回直链版本（见 [竞态记录](../../bugs/2026-07-12-latest-json-rewrite-race-with-platform-builds.md)）。
- 平台构建失败时用 Actions 页面 "Re-run failed jobs"，不用整个 workflow 重跑。
- 签名 pubkey 在 `tauri.conf.json`，私钥在 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY`）。
