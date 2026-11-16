# Toast Card 与宿主 controller 的分工

[ReminderToast.tsx](../../../src/app/windows/ReminderToast.tsx) 只组装卡片栈与互斥的内容分支；[controller.ts](../../../src/app/windows/toast/controller.ts) 管理显示／关闭、动作和窗口协作。

| kind | React 内容组件 |
|---|---|
| rest | [RestToastCard.tsx](../../../src/components/RestToastCard.tsx) |
| update | [UpdateToastCard.tsx](../../../src/components/UpdateToastCard.tsx) |
| rest-timer | [RestTimerToastCard.tsx](../../../src/components/RestTimerToastCard.tsx) |
| notification | [NotificationToastCard.tsx](../../../src/components/NotificationToastCard.tsx) |
| special | [SpecialDayToastCard.tsx](../../../src/components/SpecialDayToastCard.tsx) |
| sdk | [SdkToastCard.tsx](../../../src/components/SdkToastCard.tsx) |
| 外部插件 | [PluginHostCard.tsx](../../../src/components/PluginHostCard.tsx) |

controller 的纯函数模块分别负责 Bus 映射、计时、尺寸、滚动、激活与休息计时。业务组件通过 callbacks 请求动作，不能直接绕过总线维护第二份事件状态。卡片内展开／折叠使用 resize callback 或 ResizeObserver，让窗口跟随内容变化。

Agent 等插件专属 UI 由独立插件包提供，宿主不把会话模型塞进通用 Toast 容器。新增内容边界见[卡片约定](../../features/toast-window/dedicated-card-renders-own-body-generic-template-must-exclude-it.md)。
