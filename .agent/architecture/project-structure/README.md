# 项目结构

## 技术栈

| 层级 | 选型 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3 + TypeScript + Vite + naive-ui |
| 图表 | 无 ECharts，时间轴用 CSS Grid |
| 后端 | Rust：device_query（键盘鼠标）、rusqlite（DB）、tokio、active-win-pos-rs（焦点窗口）、windows（WASAPI 音频，Windows 专属）、reqwest（HTTP）、uuid（devKey）、md5（签名）、semver（版本号）|
| 插件 | tauri-plugin-autostart、opener、window-state、updater、process、single-instance、store |

## 目录结构

```
.
├── src/                  # Vue 3 前端
│   ├── api/tauri.ts
│   ├── assets/
│   ├── components/
│   │   ├── settings/     # 设置页卡片组件
│   │   ├── plugins/      # 插件中心侧栏/顶栏/内置 Panel
│   │   ├── Timeline.vue / TimelineWindows.vue / *ToastCard.vue
│   ├── i18n/             # vue-i18n zh-CN / en-US
│   ├── router/index.ts   # hash 路由；MainShell / ToastShell nested
│   ├── utils/timeBlocks.ts
│   ├── views/
│   │   ├── mainWindow/   # 主窗：MainShell + Dashboard/Plugins/Settings/Debug
│   │   └── toastWindows/ # 独立窗：ToastShell + Reminder*/PluginHost
│   ├── App.vue           # 仅 provider + 全局样式 + RouterView
│   ├── theme.ts / main.ts
├── src-tauri/            # Tauri 2 + Rust
│   ├── src/
│   │   ├── main.rs       # 入口 → lib::run()
│   │   ├── lib.rs        # 主业务逻辑（采样/结算/通知/命令/托盘）
│   │   ├── db.rs         # SQLite 读写 + block/喝水记录
│   │   ├── reminder.rs   # 提醒状态机
│   │   ├── water.rs      # 喝水提醒状态机
│   │   ├── reminder_toast.rs  # Toast 窗口管理
│   │   ├── media_audio.rs     # WASAPI 音频检测
│   │   ├── plugin_api/        # 外部插件宿主原语（含 rodio 播放）
│   │   ├── report.rs     # 启动事件上报
│   │   └── window_manager/    # 无焦点窗口
│   ├── Cargo.toml / tauri.conf.json
├── .agent/               # AI 知识库
├── AGENTS.md             # Agent 导航入口
```

> Rust 侧未按原计划分 `input/`、`engine/` 等目录，全部集中在 `lib.rs` 通过模块级函数组织。后续扩展建议拆分。

## 构建命令

```bash
pnpm dev              # 前端开发（不启动 Tauri）
pnpm tauri dev        # Tauri 开发模式
pnpm tauri build      # 构建发布版
cd src-tauri && cargo check / cargo test
```

## 代码约定

- 前端：Vue 3 Composition API + `<script setup>` + TypeScript
- 所有样式尺寸统一 **rem**（1rem = 16px），例外：物理 1px 边框、backdrop-filter blur、SVG viewBox
- 简单前端配置用 **Tauri Store 插件** JSON 存储，复杂/后端需读取的才进 SQLite
- 跨平台必须条件编译隔离，禁止硬编码单平台
- 修改版本号前必须读 `docs/version-management.md`
