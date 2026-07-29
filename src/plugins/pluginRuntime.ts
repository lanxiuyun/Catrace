import {
  computed,
  h,
  markRaw,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Component,
} from 'vue'
import {
  NAlert,
  NButton,
  NDivider,
  NInput,
  NModal,
  NPopconfirm,
  NProgress,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
  NTag,
  NTooltip,
  useDialog,
  useMessage,
} from 'naive-ui'
import SettingRow from '../components/settings/SettingRow.vue'
import SliderControl from '../components/settings/SliderControl.vue'

/** Minimal Vue APIs for external ESM plugins (bare `vue` import won't resolve from Blob URL). */
export type PluginVueRuntime = {
  h: typeof h
  ref: typeof ref
  computed: typeof computed
  watch: typeof watch
  markRaw: typeof markRaw
  onMounted: typeof onMounted
  onBeforeUnmount: typeof onBeforeUnmount
}

/**
 * Curated naive-ui surface for external plugins.
 * Components work with `h(NButton, props, slots)` under host NConfigProvider.
 * `useMessage` / `useDialog` must be called inside `setup()` (providers already wrap App).
 */
export type PluginNaiveRuntime = {
  NAlert: typeof NAlert
  NButton: typeof NButton
  NDivider: typeof NDivider
  NInput: typeof NInput
  NModal: typeof NModal
  NPopconfirm: typeof NPopconfirm
  NProgress: typeof NProgress
  NRadioButton: typeof NRadioButton
  NRadioGroup: typeof NRadioGroup
  NSelect: typeof NSelect
  NSlider: typeof NSlider
  NSpace: typeof NSpace
  NSwitch: typeof NSwitch
  NTag: typeof NTag
  NTooltip: typeof NTooltip
  useDialog: typeof useDialog
  useMessage: typeof useMessage
}

/** Host settings building blocks — same components as System Settings cards. */
export type PluginUiRuntime = {
  SettingRow: Component
  SliderControl: Component
}

declare global {
  // eslint-disable-next-line no-var
  var __CATRACE_VUE__: PluginVueRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_NAIVE__: PluginNaiveRuntime | undefined
  // eslint-disable-next-line no-var
  var __CATRACE_UI__: PluginUiRuntime | undefined
}

/**
 * Inject host runtimes for external plugin Blob modules.
 * Safe to call from main + toast windows; idempotent.
 */
export function ensurePluginRuntime() {
  const g = globalThis as typeof globalThis & {
    __CATRACE_VUE__?: PluginVueRuntime
    __CATRACE_NAIVE__?: PluginNaiveRuntime
    __CATRACE_UI__?: PluginUiRuntime
  }

  if (!g.__CATRACE_VUE__) {
    g.__CATRACE_VUE__ = {
      h,
      ref,
      computed,
      watch,
      markRaw,
      onMounted,
      onBeforeUnmount,
    }
  }

  if (!g.__CATRACE_NAIVE__) {
    g.__CATRACE_NAIVE__ = {
      NAlert,
      NButton,
      NDivider,
      NInput,
      NModal,
      NPopconfirm,
      NProgress,
      NRadioButton,
      NRadioGroup,
      NSelect,
      NSlider,
      NSpace,
      NSwitch,
      NTag,
      NTooltip,
      useDialog,
      useMessage,
    }
  }

  if (!g.__CATRACE_UI__) {
    g.__CATRACE_UI__ = {
      SettingRow: markRaw(SettingRow),
      SliderControl: markRaw(SliderControl),
    }
  }
}
