# 插件中心

插件中心（React）：**发现插件 / 已安装 + 插件详情弹层**。从固定的 `https://github.com/lanxiuyun/catrace-plugin` 获取可安装插件，下载到本机 AppData，再由用户选择启用。安装、启用与卸载是独立动作。

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

- **页面**：`max-width: 76rem` 居中，顶部直接呈现「发现插件 / 已安装」和搜索；搜索右侧为「打开插件目录」与刷新。不显示宣传页头、统计卡、仓库外链和重复的目录页脚。
- **发现插件**：只列固定仓库提供的插件，显示名称、版本、说明与安装状态；点击安装下载完整插件目录，不要求用户安装 Git。
- **已安装**：内置久坐提醒与本机外部插件；离线时仍可管理，不被远程目录失败挡住。
- **详情**：页内独立详情，关闭后保留列表搜索和滚动位置；内置 React 设置与现有外部 Vue 设置共存，插件浮层不受模态焦点限制。
- **安装 / 启用分离**：安装默认停用。启用前使用信任确认，说明本地代码、文件、网络和进程能力；未启用不导入 UI / settings 源码。
- **启停**：等待后端持久化与生命周期操作完成后重读目录，不用乐观状态冒充成功；后端事件也同步主窗与 Toast 注册表。
- **卸载**：确认后先停后台与 sidecar，再移除本地安装；配置保留以便重装，禁止卸载内置提醒。
- **反馈**：显式加载、失败与重试，操作期间按钮显示忙碌；本地与远程错误分离，不静默伪装为空目录。
- **安全与路径**：显示真实安装路径；GitHub 目录绑定 commit SHA，安装同一快照；路径穿越、符号链接与解压资源限制由后端校验。
- **无障碍**：Radix 管理焦点和 Escape；键盘 focus、窄窗口、高对比度、降低动态效果均有降级，不做装饰性大位移动画。

## 操作路径

1. 打开「发现插件」，选择插件并点「安装」。
2. 点「管理」或插件卡片，打开详情，使用开关并确认信任后启用。
3. 关闭开关只停用，文件和配置仍保留；「卸载」移除安装但保留配置。
4. 搜索右侧的「打开插件目录」定位到本机安装位置；旁边刷新按钮重新读取本机和仓库目录。前端已移除文件夹 / ZIP 安装，仅保留仓库安装。

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
