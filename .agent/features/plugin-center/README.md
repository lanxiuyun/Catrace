# 插件中心

React 主窗中的插件管理页：**已安装 / 发现 + 整页详情**。默认打开「已安装」，包含内置久坐提醒和本机外部插件。插件按仓库固定 commit 下载到 AppData，安装默认停用，用户通过开关启用；切换插件源不影响已有安装。宿主页面控件已改用 HeroUI；外部插件设置页也已统一迁到注入的 HeroUI，尚未迁移的 Card / 旧设置页仍用注入的 Radix。

## 实现入口

| 职责 | 文件 |
|---|---|
| 久坐提醒配置、启停、自动保存 | [Plugins.tsx](../../../src/app/pages/Plugins.tsx) |
| 列表、详情、历史记录、卸载确认 | [PluginCenter.tsx](../../../src/app/pages/plugins/PluginCenter.tsx) |
| 远程 / 本机目录、安装、更新、启停、卸载、操作互斥 | [usePluginCatalog.ts](../../../src/app/pages/plugins/usePluginCatalog.ts) |
| 更新提醒的版本比较 | [pluginUpdate.ts](../../../src/app/pages/plugins/pluginUpdate.ts) |
| 外部 React 设置组件 | [ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) |
| 插件源弹层与持久化 | [PluginSourceSettings.tsx](../../../src/app/pages/plugins/PluginSourceSettings.tsx) / [pluginRepositorySource.ts](../../../src/app/pages/plugins/pluginRepositorySource.ts) |
| 详情布局与控件样式 | [plugins.css](../../../src/app/pages/plugins.css) |
| 清单、扫描、启停、卸载 | [plugins.rs](../../../src-tauri/src/plugins.rs) |
| 仓库目录与快照下载 | [plugin_repository.rs](../../../src-tauri/src/plugin_repository.rs) |
| 模块加载与跨窗口注册表更新 | [loadExternalPlugins.ts](../../../src/plugins/loadExternalPlugins.ts) / [bootstrap.ts](../../../src/app/bootstrap.ts) |

## 操作与信任

1. 「发现」仅显示当前仓库的目录，安装下载完整插件包，不要求用户安装 Git。
2. 安装和启用分离：新安装停用；开关直接生效，不额外弹信任确认。启用即信任本地代码，包括 WebView 模块和可选 sidecar；未启用不导入 UI / settings、不启动后台。
3. 启停等待后端持久化与生命周期操作完成，再静默重读本机目录。成功不弹 toast；失败显示错误并恢复后端权威状态。
4. 关闭开关保留文件与配置。卸载需确认，先撤销启用并停止后台 / sidecar，再移除文件；配置保留、信任保持停用。内置久坐提醒不能卸载。
5. 卸载成功按返回动效回列表，失败留在详情。异步返回时用 ref 读最新视图状态，避免重复弹历史记录。
6. 本机安装位置由 `get_plugins_dir` 返回；界面不写死用户路径。插件开发在独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 维护。

宿主强制身份、启用状态、Event 所有权与 storage namespace 隔离；窗口 label / sidecar manager 推导身份。安装和解压拒绝路径穿越、符号链接等非法包内容，限制资源大小。

## 列表与详情

- 搜索同时匹配 id / 名称 / 描述；两个列表都按显示名称升序排序，`localeCompare` 使用 `sensitivity: 'base'`。
- 整张卡片可打开详情，开关 / 安装按钮在点击层上方独立响应。已安装卡以开关表示启用状态，停用仅降低图标与标题视觉强调，卡片仍可操作；发现页只显示「已安装」标记（有更新时卡片底部额外给更新按钮），不显示启用状态。
- 例外状态显示清单错误或同 ID 来自其它源。远程请求失败不影响本机管理；本地与远程错误分别显示，不把失败伪装为空目录。
- 已安装插件若当前仓库 HEAD 目录里的版本高于本机清单版本，卡片版本行和详情版本标签写成 `本机版本 → 仓库版本`（纯版本号，不带 `v` 前缀）：旧版本保持次要灰、箭头弱化，目标版本用正文色加粗——颜色只给可点击的控件，不给版本数字上强调色；也不加底色标签，避免每张卡都挂一枚抢眼的徽章；同 ID 来自其它源时版本不可比，沿用来源例外状态不提示。版本比较见 [pluginUpdate.ts](../../../src/app/pages/plugins/pluginUpdate.ts)。
- 有更新时列表版本行显示 `本机版本 → 仓库版本`，更新按钮放在**已安装卡片标题行、启动开关左侧**（和开关同一块浮层，App Store 式行内按钮）；详情页不再放更新按钮。更新走 `update_repository_plugin`：按目录快照覆盖安装插件目录，保留配置和更新前的启用状态（启用中的 sidecar 用新代码重启），前端随后强制重建 Blob 模块并广播 `catrace:reload-external-plugins` 让 Toast 窗同步，最后静默重读本机目录。安装路径仍然拒绝覆盖已安装的 ID，只有更新命令能覆盖。
- 打开插件中心时先用 Store 里上一次成功的仓库目录（`plugin_catalog_cache`，只接受当前插件源）显示版本和更新提示；缓存写入时间在 5 分钟内就跳过自动刷新（手动刷新 / 切换插件源不受限制），避免每次打开或 dev 重载都重发请求。后台刷新失败时同源缓存不会被清空，避免已安装页因为一次网络失败就看不到最新版本。
- 后端对目录做进程内缓存：先只拉一次 HEAD commit（条件请求，304 不消耗配额），commit 没变直接复用上次目录，不再逐个拉 manifest；manifest 按 8 路并发，单个请求遇到 429 / 5xx 最多重试两次。文件线路被限流时返回 `source_rate_limited`，前端显示专门的「线路被限流（HTTP 429）」提示而不是通用的「无法连接」。
- 卡片整卡可点是 `.ct-market-card-open` 绝对定位热区（`z-index: 1`），所以列表里的开关和动作按钮必须抬到 `z-index: 2`；选择器要写 HeroUI 的 `.button` / `.switch`，不要用 Radix 的 `.rt-Button` / `.rt-SwitchRoot`——写错时按钮会落在热区下面，hover 和点击全被热区吃掉（表现为「按钮 hover 没反应、点更新却打开了详情」）。按钮外观沿用 HeroUI tertiary 胶囊样式，开关的 hover 交给 HeroUI 默认，不再额外加样式。
- 详情是页内整页视图，只有插件内容视口参与 push/pop，侧栏静止。吸顶返回条在内容滚到其下方时出现材质，大标题滚出后显示插件名；总开关 / 安装按钮在标题行右侧。
- 打开详情从顶部开始，返回恢复列表搜索、滚动与焦点。每个详情占一条 `location.state.pluginDetail` 历史记录：鼠标侧键 / Alt+← 关闭详情，前进重新打开；页内返回用 `navigate(-1)`，无可弹记录时 replace 清掉标记。
- 内置和外部设置都是 React 组件。外部面板订阅 registry 更新；配置跨窗口变更由宿主转发为按 id 的 DOM 事件，监听在卸载时清理，渲染失败可重试。详情不是模态弹窗，插件 Portal 浮层可正常交互。
- 列表 / 详情转场规则见 [plugins.css](../../../src/app/pages/plugins.css)。方向通过 `view-transition-name` 表达，快照画布必须不透明且裁剪在内容视口内；API 不可用或用户要求降低动态效果时直接切换。
- 工具栏启停时不整体置灰，避免无关按钮闪烁；详情开关在操作期间按当前实现禁用。滚动所有者、内容边距和控件规范见下方子文档。
- 工具栏刷新按当前 tab 分派：已安装页「重载本地插件」＝旧版 reload，重启所有已启用 sidecar、按内容指纹强制重建前端 Blob 模块、广播 `catrace:reload-external-plugins` 让 Toast 窗同步重建卡片，最后重读本机目录；发现页只重拉仓库目录。两个 tab 只按自己的请求禁用按钮 / 显示转圈，远程慢不阻塞本机重载，本机错误也不影响仓库刷新。

## 单仓库插件源

- 支持 GitHub 的 `owner/repo`、GitHub / Gitee 公开仓库 URL（可带 `.git`），仅默认分支。不支持任意主机、私有 token、分支或子目录 URL。GitHub 规范值为 `owner/repo`，Gitee 为完整 URL。
- 仓库按 `<插件ID>/manifest.json` 组织。目录验证成功后，一次保存 Store 的 `plugin_repository` / `plugin_github_mirror`；保存失败回滚内存与持久化值，保持当前源和目录。
- 「插件源」提供官方 GitHub、GitHub 镜像加速、自定义地址。官方 / 加速均指向 `lanxiuyun/catrace-plugin`，选择即验证；自定义按回车验证，不隐式继承第三方镜像。Gitee 作为自定义源使用。
- 镜像只影响 raw 文件与归档传输，走 `https://ghfast.top/`；commit / tree API 仍直连 GitHub。需告知用户内容经过第三方代理，镜像不能解决 API 不可达。
- 安装传递目录返回的 `repository + commit`，不重新解析浮动分支；源切换 / 刷新时，迟到响应不能覆盖新列表。安装前写 `.catrace-source.json`，详情显示真实来源与快照，未知来源保持未知。
- 同 ID 已安装时不覆盖（安装路径）；升级走单独的更新命令，覆盖文件但保留配置与启用状态。来源不同显示例外状态，管理已有本机安装。
- GitHub 用 commit / tree API、raw 与 codeload 端点；Gitee 用固定 API / raw 端点，仅允许指定主机的重定向，最多 3 跳。
- GitHub 下载 commit 归档并校验包根；Gitee 按 commit 从 raw 逐文件下载，统一交给安装器做路径 / 链接 / 文件数与体积检查（64 MiB / 5000 文件）。
- GitHub 未认证接口存在额度限制。后端缓存 ETag、发送 `If-None-Match`；配额耗尽返回 `rate_limited|<reset epoch>`，前端显示预计恢复时间，已安装插件仍可管理。

## 子文档

- [详情布局边界](插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md)：宿主外壳与业务面板的分工。
- [设置行与控件尺寸](插件详情页设置面板的行语言与控件尺寸规范.md)：内置设置面板的 HeroUI 控件规范；外部插件设置页已同步迁到 HeroUI，Radix 只剩旧 UI。
- [外部插件设置页统一用 HeroUI](外部插件设置页统一用HeroUI组件.md)：宿主注入 `__CATRACE_HEROUI__`、迁移范围、控件映射与验证。
- [启停与列表同步](插件开关必须在持久化成功后再刷新列表.md)：持久化后更新。
- [sidecar 生命周期](sidecar启停与目录刷新边界.md)：单插件开关与后台同步边界。
- [插件活动记录](plugin-activity-getRecords-历史分钟记录.md)：读取过往分钟记录。
- [Node 运行环境](Node运行环境与便携安装接口.md)：命令解析、便携安装 API 与当前界面边界。
- [资源异常观测](插件异常标签如何判定和保持不拦截.md)：诊断阈值与不拦截原则。
- [外部插件 UI 合同](../../architecture/desktop-event-os/m10-external-plugins.md)：React 模块、注入的 HeroUI / Radix 运行时与 callbacks。
