# Windows PnP：用 IsConnected 区分配对与真连接，以及事件驱动去重

bt-music **不轮询**。sidecar 用 long-lived PowerShell 订阅 `Win32_DeviceChangeEvent`（到达/移除），事件后再扫 PnP 做 delta。误用 `Status=OK` 会把「已配对未佩戴」当成已连接。

## 监听方式（系统级变更通知）

```
Node sidecar
  └─ spawn powershell (常驻)
       ├─ 启动立刻 Write-BtSnapshotMarker（seed）
       └─ ManagementEventWatcher
            Query: SELECT * FROM Win32_DeviceChangeEvent WHERE EventType = 2 OR EventType = 3
            收到事件 → PS 侧 700ms 合并突发 → 写 UTF-8 JSON 临时文件 → stdout 一行 SNAPSHOT
  └─ readline 见 SNAPSHOT → 读文件 → applySnapshot（Node 侧再 debounce 350ms）
```

- `EventType=2` 设备到达，`3` 移除（含蓝牙连接/断开引发的 PnP 树变化）。
- 不是「蓝牙专用 API」，而是 OS 设备变更通知；判定是否耳机仍靠下面的 IsConnected 门控。
- watcher 退出会 2s 后自动重启；shutdown 时 `taskkill /T /F` 清进程树。
- `status.watchMode = "device-change-event"`；`pollIntervalMs` 已废弃（settings 不再暴露）。

## 正确门控

对每个候选设备读：

```powershell
Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_IsConnected'
```

- `Data -eq $true` → 射频链路在，可进快照
- 否则 **跳过**（配对残留常见 `Status=OK` 且 `IsConnected=False`）

实现：`tools/plugin-demo/bt-music/runtime/main.mjs` → `psCollectConnectedScript` / `parseEndpointFile`。

## 候选枚举（不要只扫 AudioEndpoint）

真机上 A2DP/HFP 常落在：

| Class | InstanceId 特征 |
|-------|-----------------|
| `MEDIA` | `BTHENUM` / `BTHHFENUM` |
| `Bluetooth` | `BTHENUM\DEV_…` 且名称像耳机 |
| `System` | `BTHENUM` + Hands-Free / 耳机 |
| `Bluetooth` | 服务 UUID `BTHENUM\{0000110…`（A2DP/AVRCP 等） |

仅依赖 `AudioEndpoint` + `Status=OK` 曾导致 **连上了 count=0**（端点状态长期 Unknown）。

本地扬声器/HDMI（Realtek、NVIDIA 等）要排除，除非 id/name 明确带 BTH/耳机特征。

## 一轮一机：分组与展示名

同一物理耳机常同时出现 Stereo/A2DP + Hands-Free：

1. `deviceGroupKey(name)` — 剥括号内名、去掉 Hands-Free/Stereo/通信 等后缀后 lower
2. 组内 `pickPreferredEndpoint` — 优先 A2DP/Stereo/MEDIA，压低 HFP
3. `displayNameFor` — Toast 用干净产品名（如「荣耀亲选耳夹式耳机」）

否则一次连接会连弹多张 CONNECTED。事件合并 + 分组共同防止 PnP 风暴多弹。

## 快照语义

| 标志 | 行为 |
|------|------|
| `pnpSeeded === false` | 首次成功列表只写入 `known`，**不** publish（含 watcher 启动 seed） |
| 之后 | 新 group → connected Toast；消失 → disconnect（可关） |

启用即监听：无 `watchEnabled`。手动 `refresh` RPC 可立即补一次快照。

## 中文 Windows 编码

PowerShell 控制台 stdout 常为 **CP936**，Node 按 UTF-8 读会乱码。

做法：

1. 设备 JSON 只写文件：`[System.IO.File]::WriteAllText($outFile, $json, UTF8 no BOM)`
2. stdout 仅发 ASCII 标记行 `SNAPSHOT`（不传设备名）
3. Node `fs.readFileSync(outFile, 'utf8')`

## 非 Windows

watcher 不启动；`watchSupported=false`。无模拟连接 UI。

## 手测清单

1. 启用插件后 `getStatus`：`watchMode=device-change-event`，`watcherPid` 有值；未戴耳机 `devices: []`
2. 戴上并系统已连：约 1s 内 CONNECTED Toast 一张、中文名正常（非轮询间隔）
3. 摘下断开：可选断开 Toast
4. 禁用插件 → PowerShell watcher 进程退出
