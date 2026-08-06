# 2026-07-25 主窗与 Toast 窗 views 拆分与 nested-route 外壳

## Session goal

`App.vue` 过重：主窗 chrome 与 Reminder/Toast 路径耦在一起。按窗口职责拆 `views`，用 router nested 选壳。

## Completed

- `src/views/mainWindow/`：Dashboard / Plugins / Settings / Debug + `MainShell`
- `src/views/toastWindows/`：Reminder* / PluginHost + `ToastShell`
- `App.vue` 收敛为 provider + 全局样式 + 单层 `RouterView`
- `router` 两套 parent shell + children；显示哪个 view 完全由路由决定
- 下沉页面的相对 import 统一多一层 `../`

## Pending

- 无（本轮纯结构拆分；外部插件 settings 面板接线仍是插件中心 next）

## Key file changes

| File | Change |
|------|--------|
| `src/App.vue` | 去掉 path 分支与 header；只留 naive provider |
| `src/router/index.ts` | nested MainShell / ToastShell |
| `src/views/mainWindow/MainShell.vue` | 主窗 header/nav/KeepAlive |
| `src/views/toastWindows/ToastShell.vue` | 透明背景 + 子路由 |
| `src/views/{mainWindow,toastWindows}/*` | 原 views 按职责搬迁 |

## Key conventions

- 主窗与 Toast 窗目录、Shell、路由 children 三分一致，禁止交叉 import 页面。
- 改导航改 `MainShell`；改透明窗改 `ToastShell`；不要回写 `App.vue` 分支逻辑。
