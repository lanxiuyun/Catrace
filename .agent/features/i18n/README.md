# 国际化 i18n

## 涉及文件

- `src/i18n/index.ts` — vue-i18n 配置
- `src/i18n/locales/zh-CN.ts` — 中文
- `src/i18n/locales/en-US.ts` — 英文
- `src-tauri/src/lib.rs` — Rust 侧通知/托盘文本本地化
- `src-tauri/src/plugin_api/host.rs` — `plugin_api_i18n_get_locale`
- `src/plugins/pluginApi.ts` — `plugin.i18n.getLocale()`

## 语言

| 配置值 | 语言 |
|--------|------|
| `zh-CN` | 简体中文 |
| `en-US` | English |

## 默认策略

首次启动从 `navigator.language` 自动检测，保存到 DB 的 `locale` 配置项。无法检测时回退 `zh-CN`。

## 插件 Toast 按钮

外部插件后台窗复用同一份 `index.html`（`lang="en"`）。**不要**用 `document.documentElement.lang` 判断 UI 语言。

按钮/缺省标题走 `plugin.i18n.getLocale()`（读 DB `locale`，空则 `zh-CN`）。规则自己填的 title/body 保持原文。定时提醒见 [[timer-plugin]]。

## 新增文案

1. 前端的 i18n key 加到 `zh-CN.ts` 和 `en-US.ts`，两边 key 必须一致
2. Rust 侧使用 `get_locale()` 函数判断语言返回对应文本
3. 设置页 SystemSettingsCard 有语言切换器
4. `accessibilityBanner.*` 是主窗横幅文案，和 `settings.accessibility.*` 分开；两边 zh/en key 都要齐
