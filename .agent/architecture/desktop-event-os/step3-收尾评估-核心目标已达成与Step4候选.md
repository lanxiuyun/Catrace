# Step 3 收尾评估（2026-08-03）

> 对照 [step3-roadmap-plugin-runtime.md](step3-roadmap-plugin-runtime.md) 与 [plugin-native-sidecar-runtime.md](plugin-native-sidecar-runtime.md)。  
> 结论：**Step 3 核心目标已达成，可关账；剩余项均为刻意暂缓/按需，不挡进入 Step 4 候选评估。**

## 1. Step 3 目标回顾

把插件从「被动 Toast 卡」升级为「主动后台运行时」：

| 能力 | 选型 | 结果 |
|------|------|------|
| 后台常驻 JS | 隐藏 WebView + `background.mjs` | ✅ M11 |
| 信任与隔离 | 启用即信任；身份/Event/Storage 由 Rust 强制 | ✅ M11.1 |
| 设置面 | `settings.mjs` + 宿主外壳 | ✅ M13（除 timer 让权） |
| 本机 OS 能力 | 可选 sidecar + stdio JSONL，宿主不写业务洞 | ✅ M15.1–M15.3 |

## 2. 里程碑账本

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **M11** Background Window | ✅ 关 | 启停、publish/activity/storage/log、真机验收 |
| **M11.1** 隔离与异常观测 | ✅ 关 | 无 permissions；异常 Tag 不拦截 |
| **M12** 更多宿主能力 | 🧊 按需 | **不作为 Step 3 出口阻塞**。OS 类走 sidecar；原语（open_path 等）有插件需求再加 |
| **M13** External Settings | ✅ 主体关 | settings 渲染 + config/storage 互通已有；「官方 timer 让权内置」→ M14 |
| **M14** 内置插件迁移 | 🧊 暂缓 | rest/water/eye/timer 仍可内置兜底；不挡 Runtime 产品化 |
| **M15** Native Sidecar | ✅ 关 | lifecycle + publish/log/resolved + storage 往返 + UI runtime + 信任文案 |

## 3. 能力矩阵（已交付）

```
用户插件目录
  ├─ ui.mjs          → Toast 卡（Blob）
  ├─ settings.mjs    → 插件中心详情
  ├─ background.mjs  → 隐藏 WebView
  └─ sidecar/        → 可选本机进程
         │
         ├─ publish / log / storage.get|set
         ├─ request/response RPC（settings↔sidecar）
         └─ resolved（Toast action 回传）
```

场景验证：

- **timer**：background + settings + storage/config  
- **sidecar-echo**：sidecar + Toast action + 桌面能力 demo  
- **bt-music**：sidecar 真蓝牙/动作模型 + 产品化 settings（业务全在插件）

## 4. 明确不在 Step 3 范围（保持）

- 插件市场 / 远程安装 / 自动更新  
- 安装包内置 Node  
- 细粒度权限弹窗  
- 宿主蓝牙等业务 API  
- 全量内置插件外置化（M14）

## 5. 已知缺口（不阻塞关账）

| 缺口 | 影响 | 建议落点 |
|------|------|----------|
| M15.3 storage **真机**往返未在本会话手测 | 低（协议+单测已有） | 下次 `tauri dev` 清单 |
| 启用后 badge 依赖 list/toggle 返回；无独立推送 | 低 | 刷新即可；有痛点再加事件 |
| 官方 timer 与内置定时可能双轨 | 中（仅启用两边时） | M14 |
| 用户安装仍靠拷贝到 `plugins/` | 中（体验） | **Step 4 首选：从文件夹/zip 安装** |
| M12 原语未清单化 | 低 | 有插件需求再开洞 |

## 6. 风险残留

| 风险 | 现状缓解 | 是否关账阻塞 |
|------|----------|--------------|
| 隐藏 WebView 定时器节流 | 分钟级可接受；秒级需再查 | 否 |
| sidecar 孤儿进程 | shutdown + taskkill 树 | 否（已有策略） |
| 恶意本地插件 | 启用=信任 + 无市场 + 信任文案 | 否（产品模型） |
| Node 未装 | 运行时错误，不崩宿主 | 否 |

## 7. 关账判定

**可以宣布 Step 3 完成。**

- 出口标准 = M11 + M11.1 + M13 主体 + M15 全完成定义勾选  
- M12 / M14 = 冰冻 backlog，进入「有需求再做」  
- 文档/manifest 已指向 Step 4 候选

## 8. Step 4 候选排序（建议）

1. **插件安装体验**（文件夹选择 / zip 解压到 `plugins/` + 刷新列表）— 用户价值最大、依赖已有 runtime  
2. **发布/打包约定**（第三方插件独立 repo 模板、版本与兼容说明）  
3. **M14 试点**：仅 timer 官方插件让权内置（水/眼/久坐继续内置）  
4. **市场评估**（仍不做自动下载；可先做「精选列表文档」）  
5. AI agent / 跨应用自动化 — 依赖更稳的 Event + 插件生态，排后

## 9. 建议下一步动作

1. （可选）真机勾一次 M15.3 手测清单  
2. 开 Step 4 短路线图：`step4-roadmap-plugin-ecosystem.md`（安装 + 打包 + M14 试点）  
3. 或直接做「从文件夹安装插件」最小切片

## 相关

- [step3-roadmap-plugin-runtime.md](step3-roadmap-plugin-runtime.md)  
- [plugin-native-sidecar-runtime.md](plugin-native-sidecar-runtime.md)  
- [sidecar-storage往返协议与Plugins-UI运行态约定.md](sidecar-storage往返协议与Plugins-UI运行态约定.md)  
- [[plugin-center]] · [[bt-music]] · [[timer-plugin]]
