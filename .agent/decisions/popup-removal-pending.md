# popup 提醒模式删除（待执行）

## 状态

Pending — 代码路径尚未彻底删除

## 背景

历史提醒模式含 `popup`。产品已收敛为：

- `toast` — 默认
- `fullscreen` — 全屏休息

UI 入口在功能插件 `RestPluginPanel`（不再经系统设置通知卡）。

## 已做

- 设置/插件 UI 不再提供 popup 选项
- 读到 `reminder_mode === 'popup'` 时自动写成 `toast`（`RestPluginPanel` load 路径）

## 仍待

- 后端/前端残留 popup 分支与字符串清理
- 确认无迁移用户依赖后再删存储兼容

## 相关

- [[settings]] RestPluginPanel 收敛
- [[reminder]]
