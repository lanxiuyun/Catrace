# 连接/断开动作模型与紧凑 Toast 卡

bt-music 产品路径：启用即听全部耳机；用户只选「连上/断开做什么」，不再堆多开关。

## 动作模型（互斥）

| 字段 | 值 | 行为 |
|------|-----|------|
| `connectAction` | `none` | 忽略连接 |
| | `notify` | 弹连接 Toast（可点启动） |
| | `launch` | 直接启动听歌，**不**弹 Toast |
| `disconnectAction` | `none` | 忽略断开 |
| | `pause` | 发系统媒体 Play/Pause 键 |
| | `close` | `Stop-Process` 结束配置的 exe |

**有更强动作就不叠通知。** 断开路径不再提供 `notify`。

### 旧字段兼容

| 旧 | 新 |
|----|-----|
| `autoLaunchOnConnect: true` | `connectAction=launch` |
| `pauseOnDisconnect: true` | `disconnectAction=pause` |
| 断开 `notify` / `notifyDisconnect:false` | `disconnectAction=none` |

Settings 保存时仍可写 legacy 镜像字段，方便旧 sidecar 读。

## Settings 布局

两卡 grid：

1. **听歌程序** — 路径、参数、测试启动/测试通知  
2. **连接 / 断开动作** — 两个 `NSelect`；仅 `connectAction=notify` 时内嵌「连接通知驻留（秒）」

无关键词、无「启用监听」、无独立通知偏好卡。

## Toast 卡（`ui.mjs`）

紧凑横条：

- 左：exe 图标（payload `playerIconDataUrl`，失败则字母）
- 中：`{deviceName} 已连接`；副行 `已关联: xxx.exe`
- 右：启动程序 + × 关闭
- 底：驻留进度条（非 sticky）

进度条约定与 Rest/Sdk 一致：

```css
animation: … var(--toast-auto-hide-ms) linear forwards;
.paused { animation-play-state: paused; }
```

**不要**再自跑 rAF 倒计时；宿主 hover 暂停的是同一套 JS timer + CSS pause。

### publish payload（连接 notify）

| 字段 | 含义 |
|------|------|
| `deviceName` | 展示名 |
| `playerPath` / `playerName` | 听歌程序 |
| `playerIconDataUrl` | `data:image/png;base64,…`（Windows ExtractAssociatedIcon） |
| `auto_hide_ms` | 非 sticky 时 |

sidecar 在 `setConfig` 时预缓存图标；publish 前若路径变了再刷一次。

## 启动 / 关闭

- **启动**：Windows `Start-Process` + 找主窗 + restore/activate（含最小化 `SetWindowPlacement`）
- **关闭**：按 path/name `Stop-Process -Force`
- **暂停**：`keybd_event` VK_MEDIA_PLAY_PAUSE

## 相关

- [windows-pnp-…](windows-pnp-用IsConnected区分配对与真连接-以及轮询去重.md)
- [[toast-window]] 进度条 hover 与热更新
