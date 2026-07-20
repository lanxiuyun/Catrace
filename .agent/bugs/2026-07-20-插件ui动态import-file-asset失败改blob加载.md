# 2026-07-20 插件 UI 动态 import file/asset 失败，改 Blob 加载

## 症状

- Plugins 页「发送测试通知」能 publish 出 `kind=demo-timer` 事件
- Toast 出现 `PluginHostCard`，但 async component loader 报 **Unhandled error**
- 或 Vue warn：Component was made a reactive object（`AsyncComponentWrapper`）

## 根因

1. **WebView 不能可靠 `import()` 本地 `file://` / Tauri `asset://` ESM**（dev/prod 均踩坑；`convertFileSrc` 路径仍失败）
2. 插件卡若使用 **template 字符串**，生产构建无 runtime compiler → 即使模块加载成功也无法渲染
3. 插件模块 **`import 'vue'` bare specifier** 在 blob/asset 上下文无法解析
4. `CardComponent` 放进 Pinia `ref(Map)` 被 deep reactive 包裹 → Vue 性能警告 / 异常

## 修复

| 点 | 做法 |
|----|------|
| 加载 | Rust `get_plugin_ui_source` 读文本 → 前端 `Blob` + `createObjectURL` → `import(blobUrl)` |
| 运行时 | 宿主 `globalThis.__CATRACE_VUE__ = { h, ref, computed, watch, markRaw }` |
| 卡实现 | demo `ui.mjs` 用 `render() + h()`，不用 template |
| 注册 | `markRaw(CardComponent)`；`PluginHostCard` 用 `shallowRef` 持有组件 |
| 时序 | Toast `onMounted` 先 `await loadExternalPlugins()` 再 listen bus |
| publish | `BusEvent.id` `#[serde(default)]`，前端测试按钮可省略真实 id |

## 不要再做

- 不要为了插件 UI 默认打开 `protocol-asset`（会拉 `http-range` 等依赖；Blob 路径已够用）
- 不要在文档里写「main 用 convertFileSrc 加载」作为唯一方案

## 相关文件

- `src-tauri/src/plugins.rs` — `get_plugin_ui_source`
- `src/plugins/loadExternalPlugins.ts`
- `src/components/PluginHostCard.vue`
- `tools/plugin-demo/demo-timer/ui.mjs`
- `.agent/architecture/desktop-event-os/m10-external-plugins.md`
