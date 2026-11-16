# Agent 通知插件接入

Agent 会话、Hook 安装、事件策略与插件卡片由独立仓库的 `agent-notify` 插件维护。开发、使用和故障知识查阅[插件 Agent 通知文档](https://github.com/lanxiuyun/catrace-plugin/tree/main/.agent/features/agent-notify)。

## 宿主边界

- 通过[插件中心](../plugin-center/README.md)发现、按固定 commit 安装并由用户启用。
- 插件导出 React Card／Settings，使用宿主注入的 React、HeroUI（设置页）与 Radix（卡片）及插件 API；合同见[外部插件加载](../../architecture/desktop-event-os/m10-external-plugins.md)。
- 后台逻辑使用 sidecar 或普通 ESM background；事件经宿主 Bus、Toast 外部卡入口展示。宿主只负责启用状态、身份、事件所有权、运行时生命周期与配置／storage 隔离。
- 涉及窗口尺寸、层级、卡片堆叠与跨插件协作的问题属于宿主，见[Toast 窗口](../toast-window/README.md)；仅该插件的会话与 Hook 业务记录写插件仓库。
