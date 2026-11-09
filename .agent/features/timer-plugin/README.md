# 定时提醒插件

`timer` 是独立外部插件，提供间隔／每日定点规则；喝水、护眼属于其规则预设。业务实现、设置 UI 和配置字段在 [catrace-plugin/timer](https://github.com/lanxiuyun/catrace-plugin/tree/main/timer) 及[插件知识库](https://github.com/lanxiuyun/catrace-plugin/tree/main/.agent)维护。

## 宿主边界

- [插件中心](../plugin-center/README.md) 按固定 commit 安装到 `app_data/plugins/timer`，安装停用，用户启用后才执行组件与后台。
- Card／Settings 使用宿主共享 React 与 Radix，callbacks 与加载合同见[外部插件](../../architecture/desktop-event-os/m10-external-plugins.md)。
- 提醒事件通过 Bus 渲染；sticky 与自动隐藏由 [Toast 模型](../../../src/app/windows/toast/toastCard.ts)解析，提示音使用 `plugin.audio`。
- 业务配置进入 `plugin_config:timer`，运行游标和去重状态进入插件 storage。宿主不为单个定时规则增加业务 command。
- 真休息阈值来自久坐配置，查询能力由宿主提供，见[数据边界](../../architecture/desktop-event-os/插件配置和运行数据必须分开存储.md)。

共享宿主的音频、语言和 Toast payload 合同分别见[提示音字段](定时提醒-toast颜色与提示音规则字段.md)、[插件语言](定时提醒-toast按钮语言读宿主locale不要读html-lang.md)与[Toast 窗口](../toast-window/README.md)。
