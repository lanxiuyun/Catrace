# 插件中心

插件中心（React）：**已安装 / 发现插件 + 页内详情**，打开页面默认停在「已安装」。一次浏览一个 GitHub 或 Gitee 公开仓库，默认 `lanxiuyun/catrace-plugin`（GitHub），可在搜索右侧「插件源」验证并切换仓库；同一弹层提供官方 GitHub、GitHub 镜像加速（文件走 `ghfast.top`）、自定义地址三项单选，不再提供 Gitee 预设或独立加速开关。插件下载到本机 AppData，默认停用；切换源不影响已安装插件。安装、启用与卸载是独立动作。

## 当前实现（React）

- `src/app/pages/Plugins.tsx` — 内置久坐提醒配置读写与自动保存
- `src/app/pages/plugins/PluginCenter.tsx` — 仓库发现、已安装列表、搜索、详情、信任确认与卸载确认
- `src/app/pages/plugins/usePluginCatalog.ts` — 远程/本地目录、真实安装启停卸载、操作互斥与错误反馈
- `src/app/pages/plugins/ExternalPluginSettings.tsx` — 复用 VueIsland，在启用后挂载现有插件设置，不要求插件立刻迁移 React
- `src/app/pages/plugins/RestSettings.tsx` / `PluginSettingRow.tsx` — 内置提醒设置
- `src/app/pages/plugins.css` — 页面、详情弹层、响应式与无障碍样式
- `src/api/tauri.ts` — `listRepositoryPlugins` / `installRepositoryPlugin` / `uninstallExternalPlugin`，以及本地目录与启停接口
- `src-tauri/src/plugins.rs` — 本机目录扫描与启停；`plugin_repository.rs` — 固定仓库目录与快照下载
- `src-tauri/src/plugin_sidecar.rs` — 单插件 sidecar 启停；目录刷新不等于重启所有插件
- `src/plugins/loadExternalPlugins.ts` / `src/app/bootstrap.ts` — 已启用模块加载、后端状态事件同步与缓存释放

> Vue 迁移前的整页组件已删除；外部插件已有 Vue 运行时通过局部兼容岛继续使用，宿主页面保持 React。历史结构说明见本目录子文档。

## 视觉与交互约定（2026-11 重构）

- **页面**：`max-width: 76rem` 居中，边距对齐概览和设置页。顶部直接呈现「已安装 / 发现插件」和搜索，默认打开「已安装」；搜索右侧为「插件源」「打开插件目录」与刷新。不显示宣传页头、统计卡、仓库外链和重复的目录页脚。
- **发现插件**：只列当前选择仓库的插件，标题旁显示来源；切换源不混合列表。点击安装下载完整插件目录，不要求用户安装 Git。
- **已安装**：内置久坐提醒与本机外部插件；离线时仍可管理，不被远程目录失败挡住。
- **排序与状态**：发现与已安装两个列表都按卡片的显示名称升序（`localeCompare`，`sensitivity: 'base'`），不再沿用后端按插件 ID 的字节序。卡片版本号旁只在「发现插件」显示绿色「已安装」小徽标；「已安装」把启用开关放在卡片标题行右上角（占据发现页箭头的位置，已安装 tab 因此不显示箭头），开关本身就是状态，不再重复文字或徽标。卡片底部只保留动作与例外状态（发现页未安装卡片的「安装」按钮、「需要处理」「同 ID 已从其他源安装」）。**整张卡片都是打开详情的点击区**：卡片内铺一个透明按钮承接点击（`z-index: 1`），开关和「安装」按钮叠在它上面（`z-index: 2`），所以点卡片任意位置都能进详情，点控件则触发控件本身；没有重复的「管理」按钮。
- **详情**：页内独立详情，关闭后保留列表搜索和滚动位置；内置 React 设置与现有外部 Vue 设置共存，插件浮层不受模态焦点限制。
- **安装 / 启用分离**：安装默认停用。启用前使用信任确认，说明本地代码、文件、网络和进程能力；未启用不导入 UI / settings 源码。
- **启停**：等待后端持久化与生命周期操作完成后**静默**重读目录（不亮 loading、不把 tab 计数变「—」），不用乐观状态冒充成功；开关本身就是反馈，切换不再弹「已保存 / 已启用」toast。后端事件也同步主窗与 Toast 注册表。不要把操作期间的 `busy` 传给所有 `Switch` 的 `disabled`：Radix Switch 的 disabled 会把轨道画成灰色，整列开关会闪一下；只在插件自身异常或内置提醒未就绪时禁用。
- **卸载**：确认后先停后台与 sidecar，再移除本地安装；配置保留以便重装，禁止卸载内置提醒。
- **反馈**：显式加载、失败与重试，操作期间按钮显示忙碌；本地与远程错误分离，不静默伪装为空目录。
- **安全与路径**：显示真实安装路径；GitHub 目录绑定 commit SHA，安装同一快照；路径穿越、符号链接与解压资源限制由后端校验。
- **无障碍**：Radix 管理焦点和 Escape；键盘 focus、窄窗口、高对比度、降低动态效果均有降级，不做装饰性大位移动画。

## 操作路径

1. 打开「发现插件」，选择插件并点「安装」。
2. 点插件卡片，打开详情，使用开关并确认信任后启用。
3. 关闭开关只停用，文件和配置仍保留；「卸载」移除安装但保留配置。
4. 搜索右侧的「打开插件目录」定位到本机安装位置；旁边刷新按钮重新读取本机和仓库目录。前端已移除文件夹 / ZIP 安装，仅保留仓库安装。

## 单仓库插件源

- 支持 `owner/repo`（GitHub）、`https://github.com/owner/repo`、`https://gitee.com/owner/repo`（可带 `.git`），仅公开仓库、默认分支；不支持任意主机、私有 token、分支或子目录链接。Gitee 源保存为 `https://gitee.com/owner/repo`，GitHub 源仍是 `owner/repo`（兼容旧设置与旧安装来源）。
- 源仓库必须按 `<插件ID>/manifest.json` 组织。输入验证、目录读取成功后，才保存至 `settings.json` 的 `plugin_repository`；保存失败保持原来的源和列表。
- 「插件源」弹层仅提供「官方源（GitHub）」「GitHub 镜像加速（ghfast.top）」「自定义地址」单选；自定义地址只在选中时展开。官方与加速均指向官方仓库，只有加速项开启 `plugin_github_mirror`；自定义不隐式继承加速，旧自定义仓库即使保存过加速开关也按直连加载。入口根据已保存的仓库与加速状态展示当前项；旧 Gitee 仓库仍可兼容读取，归为自定义。弹层没有确认按钮：选中官方或加速项即用目标路由验证并切换；自定义地址选中后展开输入框，按回车验证切换，空值不提交。验证成功后一次保存仓库与加速状态，失败回滚二者并保留原选中项。切换只影响发现列表，已安装插件继续独立管理、启停和卸载。
- 安装显式传递目录返回的 `repository + commit`，切换/刷新时的旧响应不能覆盖当前列表。
- 安装时宿主在发布前写入 `.catrace-source.json`，详情显示来源仓库和快照。旧安装来源未知，不能猜测为官方。
- 当前源出现与已有安装相同的 ID 时不覆盖；不同来源会显示「同 ID 已从其他源安装」，管理按钮打开真实已安装插件。
- HTTP 端点按 provider 构造固定主机：GitHub 用 `api.github.com` / `raw.githubusercontent.com` / `codeload.github.com`；Gitee 用 `gitee.com/api/v5` 与 `gitee.com/<repo>/raw`。Gitee 的 raw 会 302 到签名 CDN，因此只对 `gitee.com`、`raw.giteeusercontent.com` 等固定仓库主机跟随重定向（最多 3 跳），其他主机一律拒绝。
- 「GitHub 镜像加速」选项对应 Store key `plugin_github_mirror`：选择后 raw 文件与整包归档改走 `https://ghfast.top/` 前缀（归档用 `github.com/<repo>/archive/<sha>.zip` 形式），API（commit/tree）仍直连 `api.github.com` —— 代理转发 API 会共用限流 token 且实测 403，不能依赖。镜像只是传输层，`repository` 与 commit 不变；选中时明确提示插件内容会经过第三方代理，且不能解决 GitHub API 无法访问的问题。
- GitHub 安装走「整包 zip → 解压 → 校验包根目录」；Gitee 的 `repository/archive/<sha>.zip` 可能返回「正在准备下载」的交互页而不是 zip，因此 Gitee 安装改为按 pinned commit 从 raw 逐个下载插件目录文件再交给同一个安装器：路径用宿主的压缩包安全规则校验、拒绝符号链接/子模块、限制 64 MiB 与 5000 个文件；原有解压限制、默认停用和信任确认规则不变。
- 接口配额：GitHub 未认证接口每小时只有 60 次，目录读取要 1 次 HEAD commit + 1 次 tree，刷新几次就可能耗尽并返回 403。`fetch_api_bytes` 对这两个 API 请求保存 ETag，并用 `If-None-Match` 重取：仓库没变时 GitHub 回 304 且**不计入配额**，同一会话刷新不再消耗次数（安装时仍会读 tree，同样走缓存）。配额耗尽时后端返回 `rate_limited|<reset 时间戳>`，前端据此显示「约 N 分钟后恢复」，不再只抛 HTTP 403；已安装插件不受影响。加内存缓存只影响目录读取，安装内容和 commit 校验逻辑不变。
- 国内网络访问 GitHub 的 raw 与归档不稳定时可选择「GitHub 镜像加速」。界面不再推荐或预置 Gitee 源；底层 Gitee 下载兼容保留，避免破坏旧设置与已安装来源记录。

## Sub-documents

- [插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md](插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md) — 面板边界约定（面板不要自己写根 padding / max-width、响应式边距只改宿主一处）；Vue 结构描述作历史参考。
- [插件状态排序和统一详情顶栏实现约定.md](插件状态排序和统一详情顶栏实现约定.md) — 状态来源、排序、顶栏边界（Vue 时期）。
- [插件中心-sidecar本机进程徽章与信任文案展示.md](插件中心-sidecar本机进程徽章与信任文案展示.md) — hasSidecar / sidecarRunning badge 与 trustNote。
- [插件异常标签如何判定和保持不拦截.md](插件异常标签如何判定和保持不拦截.md) — 异常 Tag 与观测。
- [插件开关只启停当前sidecar-刷新按钮才按enable全量重启.md](插件开关只启停当前sidecar-刷新按钮才按enable全量重启.md) — 外部 sidecar 生命周期：开关 / 关开自己 / 刷新全量。
- [插件开关必须在持久化成功后再刷新列表.md](插件开关必须在持久化成功后再刷新列表.md) — 开关与列表时序。
- [插件面板和导航栏组件化拆分.md](插件面板和导航栏组件化拆分.md) — header / nav-rail 拆分（Vue 时期）。
- [unify-plugin-panel-shell-and-section-for-agent-rest-panels.md](unify-plugin-panel-shell-and-section-for-agent-rest-panels.md) — 历史：PluginPanelShell 已废弃。
- [plugin-activity-getRecords-历史分钟记录.md](plugin-activity-getRecords-历史分钟记录.md) — 外置插件读过往热力图：`plugin.activity.getRecords`。
- [sidecar-缺node时一键安装便携Node.md](sidecar-缺node时一键安装便携Node.md) — `command: node` 且解析不到时整页遮罩一键装便携 Node（Win zip / mac·Linux tar.gz），不必重启应用。

外部插件 naive 注入与 teleport 约定见 [[timer-plugin]] / [[m10-external-plugins]]。

## 启用即信任 / 开发目录

- 用户启用外部插件 = 信任其本地代码（含 sidecar）。**不**做逐项权限弹窗。宿主仍强制：窗口 label 推导 plugin id、禁用即停能力、Event 所有权、`storage` 按插件隔离。
- 安装统一到 `app_data_dir/plugins/<id>`；Windows 当前为 `%APPDATA%/com.lanxiuyun.catrace/plugins/<id>`。界面通过 `get_plugins_dir` 显示实际路径，不写死用户目录。
- Debug 不再自动把源码 junction 到 AppData；Release 不再捆绑 / 自动灌入仓库插件，防止卸载后下次启动又出现。
- 已有单插件 junction 可以安全卸载，只移除链接，不递归删除源码目标。若插件根目录本身是 junction，安装 / 卸载会明确拒绝，要求先由用户处理根链接。
- 未保存过启用状态的旧目录也默认停用，不再信任 `enabledByDefault` 自动执行；显式保存过的用户选择继续保留。
- 插件开发在独立仓库 `catrace-plugin` 维护（宿主不再挂 submodule，需要时单独 clone）；插件中心正常使用不依赖 Git 命令或宿主源码目录。
