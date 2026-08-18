# 2026-08-02 set_plugin_config 整包写入冲掉外部插件 enabled

## 症状

启用外部插件后，改 settings 自动保存，或刷新插件列表，开关又变回关闭。

## 原因

`enabled` 存在 `plugin_config:{id}.enabled`（`set_external_plugin_enabled` 写入）。  
settings 用 `plugin.config.set({...业务字段})` **整对象覆盖** Store，payload 无 `enabled` → 键丢失 → 重扫回落 `enabledByDefault`（常 false）。

## 修复

`set_plugin_config`：若 payload **不含** `enabled`，合并保留 Store 已有值。  
显式带 `enabled` 的便携配置（如 timer）仍可覆盖。

## 插件作者

业务 `config.set` 不要写 `enabled: false`；启停只用宿主顶栏 / `setEnabled`。

## 相关

- [[插件配置和运行数据必须分开存储]]
- [[bt-music]] 自动保存 settings
