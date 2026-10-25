import { usePluginRegistry, type PluginHandle } from '../stores/pluginRegistry'

/**
 * 内置「插件」注册：event_type 边界绑到 registry。
 * 插件中心的 UI 已在 React 侧（src/app/pages/Plugins.tsx）直接实现，
 * 这里不再挂 Vue 的 SettingsComponent；等插件契约改成 React 后再统一接入。
 * 定时提醒已抽离为外部插件（tools/plugin-demo/timer）。
 */
export function registerBuiltinPlugins() {
  const registry = usePluginRegistry()

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
