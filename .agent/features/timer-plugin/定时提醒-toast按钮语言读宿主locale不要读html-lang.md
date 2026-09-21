# 定时提醒 Toast 按钮语言读宿主 locale

到点弹窗的标题/正文来自规则（护眼默认中文），按钮 label 由 `background.mjs` 在 `publish` 时写入。后台窗复用宿主 `index.html`（`lang="en"`），**不要**用 `document.documentElement.lang`。

## 现象

中文界面下到点卡会出现「护眼提醒 / 远眺一下…」+ `Got it` / `Snooze 5m` / `Skip`。设置页「测试」以前把按钮写死中文，测不出这条路径。

## 正确来源

`plugin.i18n.getLocale()` → DB `locale`（`zh-CN` | `en-US`，空则 `zh-CN`）。规则自定义 title/body 保持原文，只翻译缺省标题和三个按钮。

实现：`tools/plugin-demo/timer/background.mjs`、`settings.mjs` 的 `getLocale` / `actionLabel`；宿主 `plugin_api_i18n_get_locale`。

## 不要用的路

| 错 | 对 |
|----|----|
| `document.documentElement.lang`（默认 `en`） | `plugin.i18n.getLocale()` |
| 测试按钮写死中文、到点走另一套 | 测试与到点共用 `actionLabel` |
| `locale === 'zh-CN'` 才中文、其它全英文 | `locale` 以 `zh` 开头即中文 |
