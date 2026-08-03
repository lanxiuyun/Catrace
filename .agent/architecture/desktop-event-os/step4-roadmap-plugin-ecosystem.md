# Step 4 路线图：插件生态最小切片

> **计划真源（短）**。Step 3 Plugin Runtime 已关账。Step 4 不做市场自动下载，先补齐「用户怎么装上插件」。

## 0. 阶段定位

```
Step 3  Plugin Runtime（✅ 关账）
Step 4  插件安装与分发体验（本阶段）
Step 4+ M14 试点 / 市场评估 / AI（更后）
```

## 1. 目标与边界

### 是什么

- 用户在插件中心一键选择**文件夹**或 **zip**，安装到 `<app_data>/plugins/<id>/`
- 安装后自动 rescan，列表出现插件；默认仍需用户手动启用（信任模型不变）
- 覆盖已存在同 id：确认后整包替换（不自动迁移 config）

### 不是什么

- 不做远程市场、签名校验、自动更新
- 不做 npm 依赖安装
- 不做权限逐项授权

## 2. 里程碑

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **S4.1** 本地安装 | 文件夹 / zip → plugins 目录；UI 入口；覆盖确认 | ✅ 代码完成 |
| **S4.2** 打包约定 | 第三方插件目录结构 + zip 规范 + 独立 repo 模板说明 | 📋 |
| **S4.3** M14 试点 | 官方 timer 让权内置（可选） | 🧊 |
| **S4.4** 市场评估 | 仅文档级精选列表，仍无自动下载 | 🧊 |

## 3. S4.1 设计

### 流程

```
Plugins UI「安装插件」
  ├─ 选文件夹 → 校验 manifest.json + id
  └─ 选 .zip → 解压到临时目录 → 定位含 manifest 的根
         ↓
  目标 <plugins>/<id>/
  若已存在 → 前端确认覆盖
         ↓
  Rust 原子替换（先写 temp 再 rename）→ list_external_plugins
```

### 校验

- `manifest.json` 存在且可解析
- `id` 符合现有 `validate_id`（小写/数字/连字符）
- 安装目录名 = `id`
- zip：拒绝 `..` 路径穿越；单包体积上限（实现时写死合理值）

### 信任

安装 ≠ 启用。文案提醒：仅安装信任来源；含 sidecar = 本机代码。

## 4. 完成定义（S4.1）

- [x] 可选文件夹安装成功并出现在列表
- [x] 可选 zip 安装成功
- [x] 同 id 覆盖需确认；取消不改动
- [x] 非法 manifest / 坏 zip 有明确错误，宿主不崩
- [x] `cargo check` / `pnpm vue-tsc --noEmit` 通过

实现落点：

| 路径 | 职责 |
|------|------|
| `src-tauri/src/plugins.rs` | `install_external_plugin`；zip 解压防穿越；目录拷贝；原子替换 |
| `src-tauri/src/lib.rs` | 注册 command |
| `src/api/tauri.ts` | `installExternalPlugin` / `pickPluginFolder` / `pickPluginZip` |
| `PluginNavRail.vue` + `Plugins.vue` | 安装入口与覆盖确认 |
| i18n | 安装相关文案 |

## 5. 相关

- [step3-收尾评估-核心目标已达成与Step4候选.md](step3-收尾评估-核心目标已达成与Step4候选.md)
- [[plugin-center]] · [[m10-external-plugins]]
