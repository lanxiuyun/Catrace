# 2026-08-02 外部插件 Toast 热更新（generation + reload 顺序）

## Session goal

外部插件 toast 改 `ui.mjs` 后无需重启 `pnpm tauri dev` 即可看到新 UI。

## Completed

- `pluginHostCardCache`：clear 时 bump reactive generation
- `PluginHostCard`：`cardKey` 含 generation，watch 后 re-resolve
- Toast reload：先 force load → 刷 live `uiUrl` → 再 clear cache
- 插件页测试：mtime load + emit `catrace:reload-external-plugins` 后再 publish
- 用 bt-music 底部测试文案手测通过后去掉临时文案
- 提交 `be4446b` fix: 外部插件 toast 支持热更新，无需重启 dev

## Remaining

- 未做磁盘 FS watcher 自动 reload（仍手动刷新/测试）
- 若需要 settings.mjs 热更，确认 Settings 面板是否也要 generation/remount（本次仅 toast 卡）

## Key file changes

| File | Change |
|------|--------|
| `src/components/pluginHostCardCache.ts` | generation ref + clear bump |
| `src/components/PluginHostCard.vue` | cardKey@gN + watch resolve |
| `src/views/toastWindows/ReminderToast.vue` | reload 顺序与 live uiUrl |
| `src/views/mainWindow/Plugins.vue` | 测试路径 emit reload |

## Knowledge

- bug + toast-window 子文档已沉淀；旧「测试禁止 load」约定已修订为「mtime load + emit reload」
