import { usePluginRegistry, type PluginHandle } from '../stores/pluginRegistry'

/**
 * 内置「插件」注册：event_type 边界绑到 registry。
 * 内置久坐提醒设置由 React 插件中心直接提供；本模块只注册事件边界。
 * 定时提醒已抽离为外部插件（独立仓库 catrace-plugin 的 timer）。
 */
export function registerBuiltinPlugins() {
  const registry = usePluginRegistry.getState()

  const builtins: Array<{
    name: string
    displayName: string
    description: string
    events: string[]
  }> = [
    {
      name: 'rest',
      displayName: '久坐提醒',
      description: '连续活跃超时休息提醒',
      events: ['reminder.rest.due', 'reminder.rest.timer', 'kind:rest', 'kind:rest-timer'],
    },
  ]

  for (const b of builtins) {
    const handle: PluginHandle = {
      manifest: {
        name: b.name,
        version: '0.1.0',
        displayName: b.displayName,
        description: b.description,
        events: b.events,
        builtin: true,
      },
      onEvent: () => {
        /* Toast 窗直接订阅 bus；插件 onEvent 预留 */
      },
    }
    registry.register(handle)
  }
}
