import type { Component } from 'vue'
import { usePluginRegistry, type PluginHandle } from '../stores/pluginRegistry'
import WaterSettingsCard from '../components/settings/WaterSettingsCard.vue'
import EyeSettingsCard from '../components/settings/EyeSettingsCard.vue'
import ReminderSettingsCard from '../components/settings/ReminderSettingsCard.vue'
import AgentSettingsCard from '../components/settings/AgentSettingsCard.vue'

/**
 * 内置「插件」注册：先把设置卡与 event_type 边界挂到 registry。
 * Toast 卡仍由 ReminderToast 按 kind 渲染；后续再把 CardComponent 接上。
 */
export function registerBuiltinPlugins() {
  const registry = usePluginRegistry()

  const builtins: Array<{
    name: string
    displayName: string
    description: string
    events: string[]
    settingsKey?: string
    SettingsComponent?: Component
  }> = [
    {
      name: 'rest',
      displayName: '久坐提醒',
      description: '连续活跃超时休息提醒',
      events: ['reminder.rest.due', 'kind:rest'],
      settingsKey: 'reminder',
      SettingsComponent: ReminderSettingsCard,
    },
    {
      name: 'water',
      displayName: '喝水提醒',
      description: '定时喝水提醒',
      events: ['reminder.water.due', 'kind:water'],
      settingsKey: 'water',
      SettingsComponent: WaterSettingsCard,
    },
    {
      name: 'eye',
      displayName: '护眼提醒',
      description: '定时护眼提醒',
      events: ['reminder.eye.due', 'kind:eye'],
      settingsKey: 'eye',
      SettingsComponent: EyeSettingsCard,
    },
    {
      name: 'agent',
      displayName: 'Agent 通知',
      description: 'AI Agent hook 通知与权限审批',
      events: ['agent.state', 'agent.permission', 'kind:agent', 'kind:permission'],
      settingsKey: 'agent',
      SettingsComponent: AgentSettingsCard,
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
        permissions: ['notification'],
        builtin: true,
      },
      onEvent: () => {
        /* Toast 窗直接订阅 bus；插件 onEvent 预留 */
      },
      SettingsComponent: b.SettingsComponent,
      settingsKey: b.settingsKey,
    }
    registry.register(handle)
  }
}
