# 插件中心

React 主窗中的插件管理页：**已安装 / 发现插件 + 整页详情**。默认打开「已安装」，包含内置久坐提醒和本机外部插件。插件按仓库固定 commit 下载到 AppData，安装默认停用，用户通过开关启用；切换插件源不影响已有安装。

## 实现入口

| 职责 | 文件 |
|---|---|
| 久坐提醒配置、启停、自动保存 | [Plugins.tsx](../../../src/app/pages/Plugins.tsx) |
| 列表、详情、历史记录、卸载确认 | [PluginCenter.tsx](../../../src/app/pages/plugins/PluginCenter.tsx) |
| 远程 / 本机目录、安装、启停、卸载、操作互斥 | [usePluginCatalog.ts](../../../src/app/pages/plugins/usePluginCatalog.ts) |
| 外部设置的 Vue 岛 | [ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) |
| 插件源弹层与持久化 | [PluginSourceSettings.tsx](../../../src/app/pages/plugins/PluginSourceSettings.tsx) / [pluginRepositorySource.ts](../../../src/app/pages/plugins/pluginRepositorySource.ts) |
| 详情布局与控件样式 | [plugins.css](../../../src/app/pages/plugins.css) |
| 清单、扫描、启停、卸载 | [plugins.rs](../../../src-tauri/src/plugins.rs) |
| 仓库目录与快照下载 | [plugin_repository.rs](../../../src-tauri/src/plugin_repository.rs) |
| 模块加载与跨窗口注册表更新 | [loadExternalPlugins.ts](../../../src/plugins/loadExternalPlugins.ts) / [bootstrap.ts](../../../src/app/bootstrap.ts) |

## 操作与信任

1. 「发现插件」仅显示当前仓库的目录，安装下载完整插件包，不要求用户安装 Git。
2. 安装和启用分离：新安装停用；开关直接生效，不额外弹信任确认。启用即信任本地代码，包括 WebView 模块和可选 sidecar；未启用不导入 UI / settings、不启动后台。
3. 启停等待后端持久化与生命周期操作完成，再静默重读本机目录。成功不弹 toast；失败显示错误并恢复后端权威状态。
4. 关闭开关保留文件与配置。卸载需确认，先撤销启用并停止后台 / sidecar，再移除文件；配置保留、信任保持停用。内置久坐提醒不能卸载。
5. 卸载成功按返回动效回列表，失败留在详情。异步返回时用 ref 读最新视图状态，避免重复弹历史记录。
6. 本机安装位置由 `get_plugins_dir` 返回；界面不写死用户路径。插件开发在独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 维护。

宿主强制身份、启用状态、Event 所有权与 storage namespace 隔离；窗口 label / sidecar manager 推导身份。安装和解压拒绝路径穿越、符号链接等非法包内容，限制资源大小。

## 列表与详情

- 搜索同时匹配 id / 名称 / 描述；两个列表都按显示名称升序排序，`localeCompare` 使用 `sensitivity: 'base'`。
- 整张卡片可打开详情，开关 / 安装按钮在点击层上方独立响应。已安装卡以开关表示启用状态，停用仅降低图标与标题视觉强调，卡片仍可操作；发现页仅显示「已安装」标记，不显示启用状态。
- 例外状态显示清单错误或同 ID 来自其它源。远程请求失败不影响本机管理；本地与远程错误分别显示，不把失败伪装为空目录。
- 详情是页内整页视图，只有插件内容视口参与 push/pop，侧栏静止。吸顶返回条在内容滚到其下方时出现材质，大标题滚出后显示插件名；总开关 / 安装按钮在标题行右侧。
- 打开详情从顶部开始，返回恢复列表搜索、滚动与焦点。每个详情占一条 `location.state.pluginDetail` 历史记录：鼠标侧键 / Alt+← 关闭详情，前进重新打开；页内返回用 `navigate(-1)`，无可弹记录时 replace 清掉标记。
- 内置设置为 React，已启用外部设置通过 VueIsland 挂载；详情不是模态弹窗，插件 teleport 浮层可正常交互。
- 列表 / 详情转场规则见 [plugins.css](../../../src/app/pages/plugins.css)。方向通过 `view-transition-name` 表达，快照画布必须不透明且裁剪在内容视口内；API 不可用或用户要求降低动态效果时直接切换。
- 工具栏启停时不整体置灰，避免无关按钮闪烁；详情开关在操作期间按当前实现禁用。滚动所有者、内容边距和控件规范见下方子文档。

## 单仓库插件源

- 支持 GitHub 的 `owner/repo`、GitHub / Gitee 公开仓库 URL（可带 `.git`），仅默认分支。不支持任意主机、私有 token、分支或子目录 URL。GitHub 规范值为 `owner/repo`，Gitee 为完整 URL。
- 仓库按 `<插件ID>/manifest.json` 组织。目录验证成功后，一次保存 Store 的 `plugin_repository` / `plugin_github_mirror`；保存失败回滚内存与持久化值，保持当前源和目录。
- 「插件源」提供官方 GitHub、GitHub 镜像加速、自定义地址。官方 / 加速均指向 `lanxiuyun/catrace-plugin`，选择即验证；自定义按回车验证，不隐式继承第三方镜像。Gitee 作为自定义源使用。
- 镜像只影响 raw 文件与归档传输，走 `https://ghfast.top/`；commit / tree API 仍直连 GitHub。需告知用户内容经过第三方代理，镜像不能解决 API 不可达。
- 安装传递目录返回的 `repository + commit`，不重新解析浮动分支；源切换 / 刷新时，迟到响应不能覆盖新列表。安装前写 `.catrace-source.json`，详情显示真实来源与快照，未知来源保持未知。
- 同 ID 已安装时不覆盖；来源不同显示例外状态，管理已有本机安装。
- GitHub 用 commit / tree API、raw 与 codeload 端点；Gitee 用固定 API / raw 端点，仅允许指定主机的重定向，最多 3 跳。
- GitHub 下载 commit 归档并校验包根；Gitee 按 commit 从 raw 逐文件下载，统一交给安装器做路径 / 链接 / 文件数与体积检查（64 MiB / 5000 文件）。
- GitHub 未认证接口存在额度限制。后端缓存 ETag、发送 `If-None-Match`；配额耗尽返回 `rate_limited|<reset epoch>`，前端显示预计恢复时间，已安装插件仍可管理。

## 子文档

- [详情布局边界](插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md)：宿主外壳与业务面板的分工。
- [设置行与控件尺寸](插件详情页设置面板的行语言与控件尺寸规范.md)：内置设置面板和 Radix 根类名。
- [启停与列表同步](插件开关必须在持久化成功后再刷新列表.md)：持久化后更新。
- [sidecar 生命周期](sidecar启停与目录刷新边界.md)：单插件开关与后台同步边界。
- [插件活动记录](plugin-activity-getRecords-历史分钟记录.md)：读取过往分钟记录。
- [Node 运行环境](Node运行环境与便携安装接口.md)：命令解析、便携安装 API 与当前界面边界。
- [资源异常观测](插件异常标签如何判定和保持不拦截.md)：诊断阈值与不拦截原则。
- [外部插件 UI 合同](../../architecture/desktop-event-os/m10-external-plugins.md)：Vue 模块、注入与事件。
