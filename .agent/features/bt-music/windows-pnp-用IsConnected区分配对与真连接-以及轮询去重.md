# Windows PnP：IsConnected 门控与事件驱动（低延迟）

bt-music **不轮询**。sidecar 常驻 PowerShell 订阅设备变更，再扫 PnP 做 delta。

## 监听架构

```
Node sidecar
  └─ powershell (常驻)
       ├─ seed 立刻 SNAPSHOT
       └─ ManagementEventWatcher
            Win32_DeviceChangeEvent EventType=2|3
            收到 → 立刻 SNAPSHOT（几乎不 coalesce）
            写 UTF-8 JSON 文件 + stdout: SNAPSHOT why=… ms=…
  └─ readline → parseEndpointFile → applySnapshot（新设备立即 publish）
  └─ 若 event 后仍无设备：Node 短探针链再扫 IsConnected
```

- `watchMode: device-change-event`；无 `pollIntervalMs`。
- shutdown：`taskkill /T /F` 清 PS 树（watcher + 短探针 PS）；崩溃 2s 重启。

## 延迟要点（Toast 曾晚于音频）

| 做法 | 说明 |
|------|------|
| 事件后立即 snapshot | 禁止长 700ms 合并再扫 |
| 分类 `Get-PnpDevice -Class MEDIA/Bluetooth` | 全盘 Get-PnpDevice 可多秒 |
| `IsConnected` 探针 | 属性常晚于 A2DP 可播；event 空结果后 0.1–1s 多扫几次 |
| 新设备 `queueSnapshot` 立即 apply | 不靠长 debounce 挡首包 |

日志：`SNAPSHOT why=event ms=42` — `ms` 经常 >800 说明 PnP 扫仍是瓶颈。

## 探针防风暴（conhost 泄漏根因修复）

曾出现：`device-change:event` 空结果 → `scheduleConnectProbe` 把 reason 拼成
`device-change:event:probe1` → 正则 `/device-change:event/` 仍命中 →
`connectProbeLeft = 8` 被反复重置 → 无上限并发 `powershell.exe` → 上万 conhost。

硬约束（`runtime/main.mjs`）：

| 约束 | 行为 |
|------|------|
| probe 结果不重入 | reason 匹配 `probe` 时禁止再 `scheduleConnectProbe`；探针 reason 改为 `probe:N` |
| 单链 | 已在跑则跳过，禁止把 left 重置回 8 |
| 冷却 | 两条链之间至少 5s |
| 单飞扫描 | `snapshotOnce` 同时最多 1 次 Node 侧 PnP 扫；忙时只保留最新排队 |
| PS 超时 | 短生命周期 `runPowerShell` 15s 杀树 |
| teardown | `stopWatcher` 清 probe + 杀全部 active PS + bump generation 丢弃在途结果 |

手测：待机无耳机时任务管理器不应再堆积「控制台窗口主机」；日志最多见一轮 `connect probe started` + 至多 8 次 `probe:N`。

## 正确门控

```powershell
Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_IsConnected'
```

仅 `Data -eq $true` 进快照。`Status=OK` 只表示配对残留也常见。

实现：`psCollectConnectedScript` / `parseEndpointFile`。

## 候选与一轮一机

- MEDIA + BTHENUM/BTHHFENUM；Bluetooth 叶设备名称像耳机等。
- 排除本机扬声器/HDMI（无 BTH 特征）。
- `deviceGroupKey` + `pickPreferredEndpoint`：A2DP/Stereo 优先，合并 Hands-Free，避免多弹。

## 快照语义

| | |
|--|--|
| 首次成功 | 只 seed `known`，不 publish |
| 之后 | 新 group → 连接动作；消失 → 断开动作 |

## 中文 Windows 编码

设备 JSON 只写 UTF-8 文件；stdout 仅 ASCII `SNAPSHOT…`。

## 手测

1. `getStatus`：`watchMode=device-change-event`，`watcherPid` 有值  
2. 戴上：Toast/启动应贴近系统已连，日志看 `ms=`  
3. 禁用插件 → PS watcher 退出  

## 相关

- [连接断开动作模型与紧凑Toast卡.md](连接断开动作模型与紧凑Toast卡.md)
