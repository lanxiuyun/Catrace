import { computed, createApp, h, type App as VueApp, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  darkTheme,
  dateEnUS,
  dateZhCN,
  enUS,
  zhCN,
  type GlobalTheme,
  type GlobalThemeOverrides,
} from 'naive-ui'
import i18n from '../../i18n'
import { useTheme } from '../../composables/useTheme'
import { darkThemeOverrides, lightThemeOverrides } from '../../theme'

/**
 * 迁移期的 Vue 运行时：
 * - pinia 只建一个实例，React 壳与所有 Vue 岛共享（pluginRegistry / eventHub 等 store 不能分身）。
 * - 每个岛是独立 Vue app，挂载时套上宿主原有的 NConfigProvider + 消息/对话框 provider，
 *   这样页面里的 useMessage()/useDialog() 与 naive-ui 主题、语言都和迁移前一致。
 * 页面全部迁完后（M6）整块删除。
 */
export const pinia = createPinia()
setActivePinia(pinia)

const { resolved } = useTheme()

const naiveTheme = computed<GlobalTheme | null>(() =>
  resolved.value === 'dark' ? darkTheme : null,
)
const naiveOverrides = computed<GlobalThemeOverrides>(() =>
  resolved.value === 'dark' ? darkThemeOverrides : lightThemeOverrides,
)

function currentLocale(): 'zh-CN' | 'en-US' {
  const value = i18n.global.locale.value
  return value === 'en-US' ? 'en-US' : 'zh-CN'
}

function makeIslandRoot(component: Component, componentProps?: Record<string, unknown>) {
  return {
    name: 'CatraceVueIsland',
    setup() {
      return () =>
        h(
          NConfigProvider,
          {
            theme: naiveTheme.value,
            themeOverrides: naiveOverrides.value,
            locale: currentLocale() === 'zh-CN' ? zhCN : enUS,
            dateLocale: currentLocale() === 'zh-CN' ? dateZhCN : dateEnUS,
          },
          {
            default: () =>
              h(NMessageProvider, null, {
                default: () =>
                  h(NDialogProvider, null, {
                    default: () => h(component, componentProps ?? {}),
                  }),
              }),
          },
        )
    },
  }
}

export function createVueIsland(
  component: Component,
  componentProps?: Record<string, unknown>,
): VueApp {
  const app = createApp(makeIslandRoot(component, componentProps))
  app.use(pinia)
  app.use(i18n)
  return app
}
