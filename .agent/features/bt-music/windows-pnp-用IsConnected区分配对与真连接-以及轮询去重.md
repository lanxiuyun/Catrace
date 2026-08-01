# Windows PnP：用 IsConnected 区分配对与真连接，以及轮询去重

bt-music v1 **没有** OS 蓝牙回调，只靠 sidecar 定时 PowerShell 扫 PnP。误用 `Status=OK` 会把「已配对未佩戴」当成已连接。

## 正确门控

对每个候选设备读：

```powershell
Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_IsConnected'
```

- `Data -eq $true` → 射频链路在，可进快照
- 否则 **跳过**（配对残留常见 `Status=OK` 且 `IsConnected=False`）

实现：`tools/plugin-demo/bt-music/runtime/main.mjs` → `listWindowsAudioEndpoints`。

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

否则一次连接会连弹多张 CONNECTED。

## 快照语义

| 标志 | 行为 |
|------|------|
| `pnpSeeded === false` | 首次成功列表只写入 `known`，**不** publish |
| 之后 | 新 group → connected Toast；消失 → disconnect（可关） |

`watchEnabled` 默认 `false`；打开并保存后才 `setInterval` 轮询（默认 4s，钳制 1500–60000）。

## 中文 Windows 编码

PowerShell 控制台 stdout 常为 **CP936**，Node 按 UTF-8 读会乱码。

做法：脚本内

```powershell
[System.IO.File]::WriteAllText($outFile, $json, [System.Text.UTF8Encoding]::new($false))
```

Node `fs.readFileSync(outFile, 'utf8')`，`finally` 删临时文件。

## 非 Windows

枚举返回空；验收路径只有 settings「模拟连接 / 模拟断开」。

## 手测清单

1. 未戴耳机、仅配对：`refresh` / `getStatus` → `connected: []`
2. 戴上并系统已连：一轮内出现设备，Toast 一张、中文名正常
3. 摘下断开：可选断开 Toast
4. 模拟连接 → 打开听歌（默认 `notepad.exe` 或自选路径）
