# 2026-08-01 bt-music 轮询把仅配对设备当成已连接并多弹 Toast

## 症状

1. 启用轮询后一次弹出多张 CONNECTED，设备名乱码（如锟斤拷）。
2. 收紧过滤后真耳机连上却 `count:0`、不弹窗。
3. 耳机未连接（仅系统里配对过）仍 `count:1` 并弹出「荣耀亲选耳夹式耳机」。

## 根因

| 现象 | 原因 |
|------|------|
| 多弹 + 乱码 | 把多种 PnP/AudioEndpoint 都当独立设备；stdout CP936 当 UTF-8；首轮未 seed 就 publish |
| count:0 | 过滤绑死 `AudioEndpoint`+`Status=OK`；真链路在 `MEDIA`/`BTHENUM` 节点 |
| 未连接仍 count:1 | **`Status=OK` = 驱动/配对正常，≠ 正在连接**；未读 `DEVPKEY_Device_IsConnected` |

## 修复（均在插件 sidecar，无宿主 API）

- 枚举 BTHENUM/BTHHFENUM 等候选后，**必须** `IsConnected=True` 才入快照
- UTF-8 临时文件出 JSON，不用控制台编码
- `deviceGroupKey` + `pickPreferredEndpoint` 合并 A2DP/HFP
- 首次成功快照 seed-only；`watchEnabled` 默认 false

代码：`tools/plugin-demo/bt-music/runtime/main.mjs`  
说明：[windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md](../features/bt-music/windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md)

## 回归注意

- 不要再把「PnP Status=OK」单独当作蓝牙已连接
- 改候选过滤后，用「未佩戴 / 已佩戴」各测一次 `listDevices`/`refresh`，确认 `connected` 与体感一致
