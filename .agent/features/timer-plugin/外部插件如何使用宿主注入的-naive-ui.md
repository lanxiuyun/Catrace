# 外部插件如何使用宿主注入的 naive-ui

## 背景

外部 `settings.mjs` / `ui.mjs` 经 **Blob URL** `import()`，bare `import 'vue'` / `import 'naive-ui'` **解析不到**。  
宿主在加载前注入三个 global（`src/plugins/pluginRuntime.ts`）。

## Globals

| Global | 内容 |
|--------|------|
| `__CATRACE_VUE__` | `h` `ref` `computed` `watch` `markRaw` `onMounted` `onBeforeUnmount` |
| `__CATRACE_NAIVE__` | 精选组件（含 `NDatePicker`）+ `useMessage` `useDialog` |
| `__CATRACE_UI__` | `SettingRow` `SliderControl`（可选） |

注入入口：

- `loadExternalPlugins()` → 主窗插件页 / toast 预注册
- `PluginHostCard` 兜底加载卡时也会 `ensurePluginRuntime()`

## 写法

```js
const { h, ref, onMounted } = globalThis.__CATRACE_VUE__
const { NButton, NSwitch, NInput, NTooltip, useMessage } = globalThis.__CATRACE_NAIVE__

export default {
  setup(_props, { expose }) {
    const msg = useMessage() // 必须 setup 内
    // ...
    return () => h(NButton, { type: 'primary', onClick: () => msg.success('ok') }, {
      default: () => '保存',
    })
  },
}
```

## 硬约束

1. **禁止** bare import vue / naive-ui  
2. `useMessage` / `useDialog` 只能在 `setup()`  
3. 组件用 `h(Comp, props, slots)`，无 SFC template  
4. 样式：插件根 class 自包含；**teleport 组件**（`NModal` / `NDatePicker` 日历面板等）样式必须挂在浮层自己的 class 上，不能写在 `.plugin-root .modal-xxx`

日历面板依赖宿主 `NConfigProvider` 的 `date-locale`（`App.vue` 已接 `dateZhCN` / `dateEnUS`），否则月份星期是英文。

## Teleport 踩坑摘要

`NModal` 挂到 `body` → `.my-plugin .modal-body` 选择器全部 miss → 浏览器默认控件 + 双轴滚动条。  
对策：给 modal `class: 'xxx-modal'`，CSS 写 `.xxx-modal …`；或 **不要用 modal，改内联编辑**（timer 选择后者）。

## 扩组件白名单

改 `src/plugins/pluginRuntime.ts`：

1. `import { NXxx } from 'naive-ui'`
2. 加入 `PluginNaiveRuntime` 类型
3. `ensurePluginRuntime()` 赋值对象加上 `NXxx`

不必改插件包即可在下次加载拿到新组件（已打开页需刷新 / force reload settings blob）。
