# Step 2 路线图：Event Core + Signal Core

> **计划真源**。会话外 Claude Plan 副本仅作草稿；以本文 + 代码为准。  
> 状态基准：2026-07-19（骨架已合入工作区，按里程碑继续打磨/验收）

## 0. 产品定位

| 是 | 不是 |
|----|------|
| 桌面统一事件入口（协议 + 分发 + 生命周期） | 又一个更炫的 Toast 产品 |
| 桌面行为感知层（Signal） | 远程遥测 / keylogger 默认开启 |
| 同仓模块演进 | 整仓重写或独立空壳仓库 |

外部世界如何 **主动告诉** 用户/AI 并让用户操作 —— 对标「桌面的 MCP 反向通道」。

## 1. 已确认约束

- 同仓演进，不重写
- Event ∥ Signal 并行
- 光标：只存 **每秒位移距离**（+ 分钟 60 槽），不存坐标/轨迹点
- 按键：可选 **键序列**（高敏感）——默认关、二次确认、保留期、可 purge
- Event 对外：进程内 + Tauri `publish_event` 等 commands；**不做**独立 HTTP / 多语言 SDK 包（本期）
- 不改休息判定灵敏度；不整页重写 Toast；不做插件市场

## 2. 里程碑与状态

| 里程碑 | 内容 | 状态 | 说明 |
|--------|------|------|------|
| **M1** Event 协议 + Registry | lifecycle 字段、source 对齐、publish/update/resolve、单测 | ✅ 骨架完成 | `event.rs` / `bus.rs` |
| **M2** Frontend Hub | Pinia upsert、revision、水合、主窗启动 | ✅ 骨架完成 | 不驱动 Toast |
| **M3** Signal 骨架 + 落库 | `signal.rs`、三采样、`signal_minutes`、settle | ✅ 骨架完成 | legacy count 保留 |
| **M4** 键序列隐私 | 开关、保留期、设置卡、purge | ✅ 骨架完成 | 默认关 |
| **M5** Water 双写 | bus + 现有 toast | ✅ 已收敛 | 现仅 bus，无 eval |
| **M6** 验收与文档 | 手测清单、知识沉淀 | 🔲 进行中 | 真机手测待做 |
| **M7** Toast 订阅 bus | ReminderToast listen `catrace:event` | ✅ 骨架完成 | rest/water/eye |
| **M7b** 生产者迁 bus | rest/water/eye 只 publish | ✅ 骨架完成 | agent 仍 eval |
| **M7c** 内置插件注册 | pluginRegistry + settings 绑定 | ✅ 占位 | Card 组件未拆 |
| **M8** Toast 消费 hub | 渲染适配层，去掉 eval 权威 | ✅ 完成 | 内容路径全 bus；仅 dismissAgentSession 仍 eval |
| **M9** 外部 SDK / HTTP | 多语言 demo | 🧊 暂缓 | Phase 2 边界外 |
| **M10** 插件生态 | manifest + Card 注册 | 🧊 Phase 3 | 内置 registry 已占位 |

图例：✅ 完成 · 🔲 进行中 · 📋 规划 · 🧊 暂缓

## 3. 建议推进顺序（慢慢开发）

```
手测 M1–M5（cargo/vue 已过 → 真机）
    ↓
补齐缺口（Debug 信号摘要、water resolve 薄桥可选）
    ↓
M7 按优先级双写生产者（每次一个，双写规则不变）
    ↓
Signal → 可选 Event 桥（如前台切换通知）—— 单独 ADR
    ↓
Phase 3 插件 / Phase 2 外部 SDK
```

Agent 通知路线图（P5/P7…）**并行存在**，不互相替代：  
见 [[agent-notification]] `roadmap-and-progress.md`。

## 4. 每阶段「完成」定义

### M6 手测清单

1. `pnpm tauri dev` 编译运行
2. 设置 → 测试喝水：仅 **一张** Toast；主窗 `get_active_events` / hub 有 `reminder.water.due`
3. 运行 ≥2 分钟：`signal_minutes` 有 dominant、key_count、mouse 60 槽
4. 键序列关：`key_sequence_json` 为 NULL
5. 键序列开 → 有序列 → 关 → 新分钟不再写；purge / 超时清理
6. 休息判定：持续输入仍活跃；静坐休息；fullscreen 仍强制休息
7. invoke publish/update/resolve 与 hub revision 一致

### M7 双写检查表（每个生产者）

- [ ] title/body **单次**计算，bus 与 toast 一致
- [ ] bus 失败只 log，不挡 toast
- [ ] hub **不**再渲染一张卡
- [ ] `event_type` 协议名稳定；`kind` 对齐现有 toast kind
- [ ] 有用户操作时再考虑 `resolve_*` 桥

## 5. 明确不做（本期）

- 项目重写 / 独立 `desktop-event-os` 空仓
- 插件市场、外部 HTTP Event SDK、正式 Python/Node 包
- Toast 全面改走 bus / 去掉 eval
- 光标坐标轨迹持久化
- signal 进远程 report
- 用 raw key_count 重算活跃阈值
- Signal 每条采样自动打 Event（噪声）

## 6. 风险备忘

| 风险 | 缓解 |
|------|------|
| 键序列合规 | 默认关、强文案、保留期、purge、不上报 |
| 1Hz 前台卡顿 | 独立线程、锁外 `get_active_window` |
| 1Hz 鼠标抬高 legacy count | 保留 2s 移动门闩 |
| 分钟 ts off-by-one | bucket start+60 对齐 `records.timestamp` |
| 双写文案漂移 | 生产者路径单次算 title/body |

## 7. 关键文件速查

| 路径 | 角色 |
|------|------|
| `src-tauri/src/event.rs` | 协议 |
| `src-tauri/src/bus.rs` | Registry + commands |
| `src-tauri/src/signal.rs` | 采集 |
| `src-tauri/src/db.rs` | `signal_minutes` |
| `src-tauri/src/water.rs` | 双写范例 |
| `src-tauri/src/lib.rs` | settle 接线 |
| `src/stores/eventHub.ts` | 前端观察 |
| `src/components/settings/SignalSettingsCard.vue` | 隐私开关 |

## 8. 一句话进度

**Toast 内容路径已全部经 Event Bus：rest/water/eye/agent/permission/update/rest-timer。**  
仅 `dismissAgentSession` 仍用专用通道。  
下一步：真机验 agent/permission → Signal 分钟桶手测 → 设置页按 registry 挂载 → 可选拆 Card 组件。  
Desktop Event OS 长期愿景见本目录 [README.md](README.md)。
