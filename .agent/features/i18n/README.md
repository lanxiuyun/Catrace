# 国际化

语言状态的唯一前端真源是 [useShellStore](../../../src/app/store.ts)。中文与英文词条在 [locales/](../../../src/i18n/locales/)，[i18n.ts](../../../src/app/i18n.ts) 提供框架无关的 `translate(locale, key, params)` 和 React `useT()`。

## 初始化与切换

- `initLocale` 在非插件后台窗口的 bootstrap 中调用：先监听 `catrace-locale-changed`，读取 DB 的 `locale`；首次启动按 `navigator.language` 检测，回退中文。
- `setAppLocale` 先调用后端保存，成功后更新 zustand / HTML lang 并广播 `{ locale }`。Rust `set_locale` 只持久化，不自行广播。
- 收到跨窗口事件时仅应用合法的 `zh-CN` / `en-US`，不重复保存。迟到的初始化读取不能覆盖更新的事件。
- React 组件调用 `useT()` 随 locale 重渲染；框架外读取 `useShellStore.getState().locale` 后调用 `translate`。

## 插件

后台插件窗口不读取宿主设置 Store。插件使用 `plugin.i18n.getLocale()` 查询宿主语言；自行填写的标题与正文保持原文。组件合同见[外部插件](../../architecture/desktop-event-os/m10-external-plugins.md)。

## 新增词条

1. 同时补齐中文与英文 key，使用 `{name}` 插值。
2. 界面使用 `useT()`，无对应英文时回退中文，再无对应项返回 key。
3. 系统语言切换器在 [SystemSettingsCard.tsx](../../../src/app/pages/settings/SystemSettingsCard.tsx)，只能走 `setAppLocale`，避免只改当前窗口。

回归：[test-react-state.mjs](../../../scripts/test-react-state.mjs) 覆盖插值、回退、保存失败、双 WebView 同步和晚到读取。
