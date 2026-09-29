# 轻量模式省下的是哪些进程：WebView2 进程构成与排查方法

> 用户问「为什么还看到 N 个 WebView2 进程」时用这份文档对账。含：Catrace 的完整进程构成、开启轻量模式前后的实测数字、以及三个会让人误判的坑。

## 1. Catrace 的进程构成

一个跑着的 Catrace 最多由三类进程组成：

| 进程 | 数量 | 说明 |
|---|---|---|
| `catrace.exe`（Rust 主进程） | 1 | 采样、settle、Event Bus、event HTTP、sidecar 托管全在这里 |
| WebView2 底座 | 5 | `browser` 1 + `gpu-process` 1 + `utility`（网络/存储服务）2 + `crashpad-handler` 1。**只要还有一个 webview 活着就存在**，与窗口数无关 |
| WebView2 `renderer` | 每窗口 1 | 主窗 / Toast 窗 / 每个插件后台窗，各一个 |
| `node.exe`（插件 sidecar） | 每启用插件 1 | 由 manifest 的 `sidecar` 字段声明；与 WebView 无关，轻量模式不动它们 |

所以「WebView2 进程数」在任务管理器里看到的通常是 **renderer 的数量**，底座那几个折叠在「WebView2 管理器 (N)」分组标题里，不点开不算在内。

## 2. 实测数字（4 个插件：agent-notify / github-notify / pastedrop / smsforwarder-notify）

| 状态 | msedgewebview2 | catrace.exe | node sidecar | 合计工作集 |
|---|---|---|---|---|
| 改动前（普通模式，主窗常驻 + Toast 常驻 + 2 个插件后台窗） | 8+ 个进程（含底座） | ~70MB | ~230MB | ~800MB+ |
| 轻量模式 + 插件迁移后，托盘静默 | **0 个** | ~61MB | ~230MB | **~290MB** |
| 通知到达时 | 底座 + 1 个 Toast renderer | ~61MB | ~230MB | 弹完卡片清空后回落 |

关键事实：**WebView2 在最后一个 webview 销毁后会连底座一起收掉**。所以轻量模式（主窗销毁 + Toast 按需 + 插件无后台窗）三者叠加时，托盘静默状态下 `msedgewebview2.exe` 真正归零——这比最初方案里「底座 ~370MB 省不掉」的预估还好。

## 3. 排查方法

按 user-data-dir 认领进程（避免把别的应用的 WebView2 算进来），再枚举窗口把 renderer 对到具体窗口：

```powershell
# 1) Catrace 的进程树：类型 / pid / 工作集 / 启动时间
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe' OR Name='catrace.exe' OR Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'com.lanxiuyun.catrace' -or $_.Name -eq 'catrace.exe' } |
  ForEach-Object {
    $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } elseif ($_.Name -eq 'catrace.exe') { 'MAIN' } else { 'browser' }
    '{0,-16} pid={1,-7} ws={2,7}MB started={3}' -f $t, $_.ProcessId, [math]::Round($_.WorkingSetSize/1MB,1), $_.CreationDate.ToString('HH:mm:ss')
  }

# 2) 窗口清单（标题 + 尺寸 + 可见性）——尺寸能直接认出是谁
#    Toast 窗 = 392x160 逻辑像素、贴工作区右下角；插件后台窗标题 = "Catrace Plugin: <id>"
```

窗口认身份的经验值：**用尺寸和位置判定，不要只靠标题**（Toast 窗和主窗标题都是 `Catrace`）。`392x160` 就是 Toast（见 `TOAST_WINDOW_WIDTH_LOGICAL` / `TOAST_WINDOW_MIN_HEIGHT_LOGICAL`）。

## 4. 三个会让人误判的坑

**（1）插件后台窗还在 = 加载的是旧版插件（dev 环境最常见）**

debug 构建把插件 junction 进 `app_data/plugins/`，源路径是**编译期**的 `CARGO_MANIFEST_DIR`。如果 junction 是别的工位建的、而那个工位的 `tools/plugin-demo` 停在旧提交，加载到的就是还带 `background` 字段的旧 manifest → 宿主照旧给每个插件建后台 WebView。

证据看日志：`loaded github-notify v0.1.1` + `started background window for github-notify`（新版是 0.2.0 且无 background）。2026-09-29 已修（是链接就重指向当前工位），但**修复要重编该工位的 exe 才生效**；老 junction 也可以手动删掉让它重建。

**（2）轻量模式是运行中打开的 → 启动期预创建的 Toast 还在**

轻量模式只在**启动时**跳过 Toast 预创建，所以「先启动（开关关着）→ 再打开开关」的场景下，那个已预创建的隐藏 Toast 会一直留着，直到下次通知弹完卡片清空时才被销毁（或重启应用）。这是有意的设计取舍：不在开关切换时销毁窗口，避免误伤正在显示的卡片。

**（3）主窗其实没关**

轻量模式只在「关闭主窗」这个动作上销毁窗口；最小化、切后台都不会。用窗口清单确认主窗是否真的不在（标题 `Catrace` 且尺寸 ~800x600 或窗口状态里保存的几何尺寸）。

## 5. 判定表

| 看到的 renderer 数 | 含义 |
|---|---|
| 0 | 轻量模式 + 插件无后台窗，托盘静默——目标状态 |
| 1，且是 392x160 贴右下角 | 有一个隐藏的预创建 Toast（见坑 2） |
| 1，且标题 `Catrace Plugin: <id>` | 某个插件还在用 background WebView（见坑 1） |
| N = 启用的带 background 插件数 | 插件迁移没生效，对照日志的 `loaded <id> v<版本>` |
| 大于窗口数 | WebView2 回收 renderer 有延迟/会留备用 renderer，重启后再看 |

## 相关

- [README.md](README.md) — 轻量模式行为与涉及文件
- [../../bugs/2026-09-29-轻量模式关掉最后一个窗口整个应用退出.md](../../bugs/2026-09-29-轻量模式关掉最后一个窗口整个应用退出.md) — 插件后台窗消失后暴露的窗口生命周期 bug
- [../../architecture/desktop-event-os/插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md](../../architecture/desktop-event-os/插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md) — 插件侧怎么把后台逻辑搬进 sidecar
- [[window-manager]] · [[plugin-center]]
