# 外部插件 Toast 的两档外壳样式

外部插件可以通过事件 `payload.toastStyle` 选择宿主默认卡片，或完全接管当前卡片外壳。这个约定只影响 Toast presentation，不进入 Event Bus 的核心字段。

## 两种写法

### 使用宿主默认外壳

不传 `toastStyle`，或者传普通 style object：

```js
await plugin.events.publish({
  eventType: 'my-plugin.tick',
  kind: 'my-plugin',
  title: '普通通知',
  body: '使用 Catrace 默认白底卡片',
  payload: {},
  dedupeKey: 'my-plugin:tick',
})
```

### 插件完全接管外壳

传入固定 flag：

```js
payload: {
  toastStyle: 'standalone',
}
```

宿主对当前 `.toast-card` 使用 `.toast-card-standalone`，移除宿主的白色背景、padding、圆角、border 和 shadow；插件 UI 根节点负责绘制完整卡片。

### 当前 event 自定义 CSS

也可以传 CSS style object：

```js
payload: {
  toastStyle: {
    background: '#ffffff',
    borderRadius: '0.75rem',
    boxShadow: '0 0.5rem 1.25rem rgba(59, 130, 246, 0.24)',
    padding: '0.875rem',
  },
}
```

这个 object 直接绑定到当前 Toast card，适合只调整单个 event；不传则不覆盖宿主默认样式。

## agent-notify 当前用法

agent-notify 的状态卡和权限卡在 sidecar 发布时传 `toastStyle: 'standalone'`，因此由 `agent-notify/ui.mjs` 自己负责圆角、类型色条、背景和阴影。其他插件没有这个字段时，仍使用宿主标准卡片。

## 关键边界

- 样式配置放在 `payload`，不要扩散成 `BusEvent` 或 `EventPatch` 字段。
- 只允许插件事件使用 `toastStyle`；内置 rest/update 等卡片不读取它。
- flag 名称固定为 `standalone`，不要使用含义不清的 `style` 或 `custom`。
- object 值应只放 presentation CSS；不要覆盖 `position`、`width`、`height`、`transform`、`z-index` 等窗口布局属性。
- 宿主只在 `ReminderToast.vue` 统一读取、存储和绑定，旧插件无需迁移。

## 涉及文件

- `src/views/toastWindows/ReminderToast.vue` — 解析 `payload.toastStyle`，给当前 Toast card 添加 standalone class 或 inline style。
- `tools/plugin-demo/agent-notify/runtime/main.mjs` — agent-notify 发布状态/权限卡时传 `toastStyle: 'standalone'`。
- `tools/plugin-demo/agent-notify/ui.mjs` — standalone 模式下绘制插件自己的卡片外壳。
