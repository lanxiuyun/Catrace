# 2026-08-02 bt-music 去掉模拟卡并启用即监听与 Toast 倒计时

## Session goal

把 bt-music 从「演示/模拟」收成产品向：启用即监听、去掉无用保存按钮、可配置 Toast 倒计时。

## Completed

- 删除模拟连接/断开 UI 与 RPC；Toast 卡去掉 MOCK 徽章
- 去掉「保存并同步」；settings 改动 debounce 自动 `config.set` + `setConfig`
- 移除 `watchEnabled`：sidecar 启动即 `schedulePoll` + seed
- 新增 `connectedAutoHideSec` / `disconnectedAutoHideSec`（0=常驻 sticky；>0 非 sticky + `payload.auto_hide_ms`）
- manifest 0.2.0，描述去掉 mock 文案

## Remaining

- 真机：启用插件后连耳机看 Toast；改倒计时后验证自动消失
- M15.3 storage + Plugins UI sidecar 状态

## Key file changes

| File | Change |
|------|--------|
| `tools/plugin-demo/bt-music/settings.mjs` | 三卡：监听 / Toast 倒计时 / 听歌程序；自动保存 |
| `tools/plugin-demo/bt-music/runtime/main.mjs` | 始终轮询；publish 尊重倒计时；去 simulate |
| `tools/plugin-demo/bt-music/ui.mjs` | 仅 CONNECTED/DISCONNECTED |
| `tools/plugin-demo/bt-music/manifest.json` | 0.2.0 产品描述 |
| `tools/plugin-demo/README.md` | 手测步骤改为真连接 |
| `.agent/features/bt-music/README.md` | 约定同步 |
