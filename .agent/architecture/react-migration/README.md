# React 迁移方案（Vue → React）

分支 `design/react-plugin-center-prototype` 的方向：用 React 重写宿主前端，替代现有 Vue 3 壳。`tools/ui-prototype/` 的插件中心原型（React 19 + Radix Themes）已评审通过，本文是把它落成真实前端的方案。设计系统已定为 **Radix Themes + zustand**。

## 1. 结论

- **终态**：宿主 UI（壳、页面、设置、Toast 窗）与**插件 UI 全部 React**；不再保留 Vue 运行时与 naive-ui 注入。
- **路线**：先起 React 新壳（路由 / 主题 / i18n / state / Tauri hook），再按页面逐块替换，最后移除 Vue 壳与 vue-router / vue-i18n / pinia。
- **共存方向**：React 壳 + Vue 岛（未迁移页面以 Vue 实例挂进 React 路由），而不是 Vue 壳 + React 岛 —— 从第一天就把终态边界定在 React。
- **插件收口**：迁移期只保留内置「久坐提醒」，其余插件（含外部插件）全部停用，再逐个改写成 React 放回（§4）。

## 进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| M0 插件收口 | ✅ 已落地 | 前端 `pluginScope.ts` + Rust `REST_ONLY_MIGRATION`，插件页只剩久坐提醒 |
| M1 React 壳 | ✅ 已落地 | React 入口/路由/主题/i18n/zustand + Vue 岛桥；8 条路由用 Playwright 跑过 dist（页面正常渲染，浏览器里 Tauri API 报错属预期）；页面暂全部保持 Vue |
| M2 Dashboard | 待开始 | 第一个真正改写成 React 的页面 |

## 2. 现状盘点

| 层 | 现状 | 文件 / 备注 |
|----|------|-------------|
| 构建 | Vite 6 + `@vitejs/plugin-vue`；M1 起加 `@vitejs/plugin-react`（双插件共存），单入口 `index.html`，hash 路由 | [vite.config.ts](../../../vite.config.ts) |
| 窗口 | 单 HTML，多窗口靠 hash 区分：`#/dashboard`、`#/reminder-toast`、`?plugin_id=x#/plugin-host` 等 | `src-tauri/src/lib.rs`、`reminder_toast.rs`、`plugin_window.rs` |
| 壳 | `MainShell.vue`（顶栏 + 4 路由）、`ToastShell.vue`（4 个提醒/插件窗路由） | `src/views/mainWindow`、`src/views/toastWindows` |
| 页面体量 | Plugins 24.9 KB、Debug 12.9 KB、Dashboard 11.4 KB、Settings 7.9 KB；Toast 侧 ReminderToast 23.4 KB、ReminderFullscreen 17.9 KB、ReminderPopup 8.7 KB | 迁移工作量按此排序 |
| 状态 | pinia：`eventHub`（Event Bus 订阅 + 150 条已解决上限）、`pluginRegistry` | `src/stores/` |
| i18n | vue-i18n，词条是纯 TS 对象（zh-CN 19.7 KB / en-US 20.3 KB） | `src/i18n/` |
| 主题 | `useTheme`：Store 持久化 `theme.mode` → `data-theme` → 跨窗口 `catrace-theme-changed`；naive-ui overrides + `--ct-*` CSS 变量 | `src/composables/useTheme.ts`、`src/theme.ts`、`src/styles/theme.css` |
| 插件 UI | 外部插件 `ui.mjs`/`settings.mjs` 是 **Vue 组件源码**：Rust 读源码 → Blob → 动态 import；宿主注入 `__CATRACE_VUE__`、`__CATRACE_NAIVE__`（naive-ui 组件 + `useMessage`/`useDialog`）、`__CATRACE_UI__`（Vue 版 SettingRow/SliderControl） | `src/plugins/loadExternalPlugins.ts`、`src/plugins/pluginRuntime.ts` |
| Tauri API | `src/api/tauri.ts` 纯 TS 封装（19 KB），与框架无关，可直接复用 | 迁移期不动 |
| 验证 | Playwright e2e（`e2e/plugins.spec.ts`）、`vue-tsc`、`pnpm build`；原型另有 13 状态测试 + 4 渲染检查 | 迁移期 e2e 是主要回归网 |

## 3. 目标结构

```
src/
  app/                       React 宿主（M1 已落地）
    main.tsx                 入口：normalize hash → bootstrap → 渲染
    bootstrap.ts             窗口分流 / console 埋点 / 插件注册 / 语言主题初始化 / Event Bus
    preflight.ts             窗口类型判定 + ?reminder= 兼容
    router.tsx               react-router（hash 模式，路径与 Tauri 建窗一致）
    store.ts                 zustand：resolvedTheme / themeMode / locale
    i18n.ts                  t() / useT()，复用 vue-i18n 的词条对象
    shell/MainShell.tsx      顶栏（Radix Theme 局部包住）+ 内容区
    shell/ToastShell.tsx     提醒 / Toast 窗出口
    shell/shell.css          壳样式（沿用 --ct-* token）
    legacy/vueRuntime.ts     共享 pinia + 每个岛 createApp（NConfigProvider / 消息 / 对话框 provider）
    legacy/VueIsland.tsx     <VueIsland component={Page} />：把 Vue 页面挂进 React 路由
    legacy/legacy.css        原 App.vue 的全局基础样式（html/body/#app、user-select）
  views/                     未迁移的 Vue 页面（逐个清空）
```

Vite 保持单入口；共存期间 `plugins: [vue(), react()]` 同时启用。**Tauri 建窗 URL 不变**，React 路由覆盖现有全部 hash：`#/dashboard`、`#/plugins`、`#/settings`、`#/debug`、`#/reminder-toast`、`#/reminder-popup`、`#/reminder-fullscreen`、`#/plugin-host`。

## 4. 插件策略：全部改写成 React（迁移期先只留久坐提醒）

用户决定：插件也不保留 Vue，逐个改写成 React。当前落地的是"收口"这一步：

- **前端开关**：[src/config/pluginScope.ts](../../../src/config/pluginScope.ts) → `REST_ONLY_MIGRATION = true`
  - `src/app/bootstrap.ts` 跳过 `loadExternalPlugins()`，外部插件的 Card / Settings 组件不再注册；
  - 插件页 `Plugins.vue` 不再拉外部插件列表，隐藏刷新 / 安装 / 打开目录入口（`PluginNavRail` 的 `canManageExternal=false`），页面只剩「久坐提醒」。
- **Rust 开关**：`src-tauri/src/plugins.rs` → `REST_ONLY_MIGRATION = true`
  - `PluginManager::rescan` 直接返回空列表：不扫描 `app_data/plugins`，外部插件的 **UI 下发、后台 WebView、sidecar 进程、事件发布权限** 全部不会启动。
- **恢复/迁回**：某个插件改写成 React 后，两处开关同步放开（前端 id 列表 + Rust 常量）。整轮迁移结束（M6）删除两处开关。

终态契约：

- 插件 UI 从 Vue SFC 改成 **React 组件**（`Card` / `Settings` 导出 React 组件），宿主直接用 React 挂载，不再需要 `__CATRACE_VUE__` / `__CATRACE_NAIVE__` 注入，也不再需要 `<PluginUiHost>` 兼容层。
- [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 仓库里的插件逐个改写；旧 Vue 契约在迁移完成后不再支持（过渡期若要兼容，可临时保留 Vue 岛桥，但不在终态）。
- 迁移顺序建议：久坐提醒（宿主内置，先重写 `RestPluginPanel.vue`）→ 定时提醒 → 喝水 / 护眼 → Agent 通知 → 蓝牙音乐。

## 5. 设计系统（已定：Radix Themes）

| 方案 | 与原型一致性 | 组件完备度 | 代价 |
|------|--------------|------------|------|
| **Radix Themes**（原型同款） | 高，视觉已评审 | 基础组件有限：无 Table、DatePicker、表单校验，需要自研组合 | 低（沿用 `layout.css` 的设计 token），后续重型页面可能要补组件 |
| **shadcn/ui + Tailwind** | 中，需按原型重做 token | 高，组件可拷入仓库、生态最大 | 引入 Tailwind 构建链，与现有 `--ct-*` CSS 变量要打通 |
| **Mantine** | 中，视觉偏默认 | 高，hooks 齐全 | 包体较大，样式体系另起一套 |
| **Ant Design** | 低 | 最全（Table/Form/DatePicker 强） | 企业风、深度定制成本高、包体大 |
| **保留 naive-ui** | — | **不可行** | naive-ui 只有 Vue 版，React 侧不存在对应实现 |

定为 **Radix Themes**（原型同款）：起壳与插件中心延续已评审视觉；到 Debug（表格/统计密集）和设置表单时，若 Radix 组合成本过高，再局部引入 shadcn 组件或自研。下表作为当时的对比依据保留。

## 6. 工程改造要点

1. **入口与路由**：`index.html` 的挂载点改为 React root（`src/app/main.tsx`）；`react-router` 用 hash history，路由表与现有完全对齐（含窗口分流逻辑，从 `src/main.ts:17-23` 与 `:70-114` 平移）。旧 `src/main.ts` / `App.vue` / `vue-router` 暂时保留作对照，M6 删除。
2. **状态**：zustand 先接管壳级状态（`src/app/store.ts`：主题解析值、语言）；`eventHub` / `pluginRegistry` 留在 pinia，由共享的 pinia 实例同时供给 Vue 岛与 React 启动流程（`src/app/legacy/vueRuntime.ts`）。M2 起再逐个把业务 store 迁到 zustand。
3. **i18n**：词条是纯 TS 对象，React 侧自研约 1.7 KB 的 `t(key)`（`src/app/i18n.ts`，保持 `nav.plugins` 的 key 结构），locale 真源仍是 vue-i18n，经 store 镜像；不引入 react-i18next。
4. **主题**：`--ct-*` 变量与 `data-theme` 不变；`useTheme`（Vue 单例）仍是真源，React 通过 `watch` 镜像到 zustand；Radix `Theme` 只局部包住 React 壳顶栏，Vue 岛留在作用域外。
5. **多窗口**：`src/app/bootstrap.ts` 平移了窗口分流（Toast / 弹窗 / 插件后台窗）、`patchConsole`、F12 DevTools、插件日志转发、语言/主题初始化与 Event Bus 订阅。
6. **测试**：`vue-tsc` 随 Vue 页面减少逐步退役，新增 `tsc --noEmit`（React 侧）；Playwright 覆盖插件开关、更新卡片、Toast 关键路径；`pnpm build` 作为每次替换后的硬门槛。
7. **包体**：共存期 Radix Themes 全量 CSS（约 690 KB）+ naive-ui 同时进包，构建 CSS 到 761 KB；M6 删掉 naive-ui 后再收敛，必要时改用 Radix 的分文件 CSS（`tokens.css` / `components.css`）。
8. **Radix Theme 的根主题陷阱**：`<Theme>` 没有父 Theme 时会被当成 root theme，自动带上 `.radix-themes[data-is-root-theme='true'] { min-height: 100vh; position: relative; z-index: 0 }`。只包局部容器（比如顶栏）时，必须在本地 CSS 里覆盖 `min-height: 0`，否则容器会撑满整窗、同级内容区高度变 0（M1 首次实机截图就是这个症状）。

## 7. 迁移顺序与里程碑

| 里程碑 | 内容 | 验收 |
|--------|------|------|
| M0 收口 | 停用除久坐提醒外的所有插件（前端 `pluginScope.ts` + Rust `plugins.rs` 双开关） | 插件页只剩久坐提醒；无外部插件 sidecar / 后台窗 / Toast 卡 |
| M1 壳 | React 入口 + 路由 + 主题 + i18n + zustand + Tauri hook + Vue 岛桥（页面暂全部保持 Vue） | 主窗/Toast 窗路由可跑，`pnpm build` 通过；页面行为与现版一致（靠 Vue 岛） |
| M2 Dashboard | Dashboard（eventHub + 时间线） | 事件流、时间线、刷新行为与现版一致 |
| M3 设置 | Settings + 各设置卡（表单密集，验证设计系统取舍） | 设置读写/自动保存与现版一致 |
| M4 久坐提醒 | 插件页（rest only）+ `RestPluginPanel` 改写成 React | 久坐提醒的配置读写、预览提醒与现版一致 |
| M5 Toast | ReminderToast / Popup / Fullscreen / PluginHost | 多窗口尺寸、层级、事件行为与现版一致 |
| M6 清场 | 删 `src/legacy-views`、vue-router、vue-i18n、pinia；依赖收敛 | 不再依赖 vue / naive-ui |
| M7 插件迁回 | 按 §4 顺序把插件逐个改写成 React 并放开开关（含 catrace-plugin 仓库） | 每个插件单独验收，开关同步放开 |

## 8. 风险

- **插件契约重写**是最大成本：外部插件、catrace-plugin 仓库、事件权限与 sidecar 协议都要跟着走；迁移期收口只是把风险暂时隔离。
- **双框架共存**：naive-ui 全局 CSS 变量与 Radix Themes 变量、`data-theme` 与 Radix 的 `dark` class 需要统一；共存期样式隔离要专门验证。
- **KeepAlive/滚动位置/详情面板状态**：现版 MainShell 用 `<KeepAlive>` 保活页面，React 需要自己实现等价行为（或明确不做）。
- **多窗口与事件时序**：Toast 窗的 show/resize/层级逻辑对时序敏感（见 `.agent/bugs/2026-10-15-*`），迁移时不能只搬 UI。
- **i18n 词条量大**：机械替换 + 人工抽查，避免 key 漂移导致缺词。

## 9. 已确认的决策

1. 设计系统：**Radix Themes**（§5）。
2. 状态方案：**zustand**（壳级状态已落地，业务 store 按页面迁移）。
3. 共存方向：**React 壳 + Vue 岛**。
4. 插件：**全部改写成 React**，迁移期先只留久坐提醒（§4）。
