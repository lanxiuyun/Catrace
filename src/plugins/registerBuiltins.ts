import type { Component } from 'vue'
import { usePluginRegistry, type PluginHandle } from '../stores/pluginRegistry'
import RestPluginPanel from '../components/plugins/RestPluginPanel.vue'
import TimerPluginPanel from '../components/plugins/TimerPluginPanel.vue'
import AgentPluginPanel from '../components/plugins/AgentPluginPanel.vue'

/**
 * 内置「插件」注册：设置/详情组件与 event_type 边界绑到 registry。
 * 产品可见列表由 Plugins.vue allowlist 控制，不必等于此处全部。
 */
export function registerBuiltinPlugins() {
  const registry = usePluginRegistry()

  const builtins: Array<{
    name: string
    displayName: string
    description: string
    events: string[]
    settingsKey?: string
    settingsSurface?: PluginHandle['settingsSurface']
    SettingsComponent?: Component
  }> = [
    {
      name: 'rest',
      displayName: '久坐提醒',
      description: '连续活跃超时休息提醒',
      events: ['reminder.rest.due', 'reminder.rest.timer', 'kind:rest', 'kind:rest-timer'],
      settingsKey: 'reminder',
      // Full detail panel lives on Plugins page, not the compact Settings grid.
      settingsSurface: 'plugins',
      SettingsComponent: RestPluginPanel,
    },
    {
      name: 'timer',
      displayName: '定时提醒',
      description: '自定义间隔或定点提醒',
      events: ['reminder.timer.due', 'kind:timer'],
      settingsKey: 'timer',
      settingsSurface: 'plugins',
      SettingsComponent: TimerPluginPanel,
    },
    {
      name: 'agent',
      displayName: 'Agent 通知',
      description: 'AI Agent hook 通知与权限审批',
      events: ['agent.state', 'agent.permission', 'kind:agent', 'kind:permission'],
      settingsKey: 'agent',
      // Product plugin: detail on Plugins page (not system Settings).
      settingsSurface: 'plugins',
      SettingsComponent: AgentPluginPanel,
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
      SettingsComponent: b.SettingsComponent,
      settingsKey: b.settingsKey,
      settingsSurface: b.settingsSurface,
    }
    registry.register(handle)
  }
}
