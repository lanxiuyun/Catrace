# macOS 无辅助功能权限时，用系统空闲秒数兜底忙闲

久坐判定读的是每分钟 `ActivityState.count >= 3`（或媒体活跃）。macOS 上完整键鼠采样走 `device_query`，**必须**辅助功能权限。权限没了，count 恒 0，整天被判休息。

## 现行行为

启动时 `lib.rs` 查 `application_is_trusted()`：

| 状态 | 采样 |
|------|------|
| 已授权 | `start_input_sampling`（`device_query` 键边沿 50ms + 鼠标 1Hz） |
| 未授权 | **立刻** `start_input_sampling_fallback`（仅 macOS）；后台每 3s 轮询权限 |

兜底线程（`signal.rs` `macos_perm_free`，裸 FFI，不新加 crate）：

- `CGEventSourceSecondsSinceLastEventType`：距上次键/触控板/鼠标输入的秒数。`< 1.5s` 视为刚动过，按完整采样器同样的 **2s 去重** 给 `count +1`。
- `CGEventCreate` + `CGEventGetLocation`：光标位置。1Hz 欧氏位移写入 signal 分钟桶，**2s 移动窗口** 再给 `count +1`。

授权后：把 fallback 的 `active` 置 false 停线程，再开完整采样，避免双计。

主窗 `MainShell` 顶部挂 `AccessibilityBanner.vue`：仅 macOS 且未授权时显示，点按钮调系统授权面板，2s 轮询，授权后自动收起。设置卡里的授权行仍保留。

Windows / Linux 不编译这条路径。

## 为什么必须这样

macOS TCC 把辅助功能授权绑在**代码签名**上，不是应用名。当前 CI 用 `tauri.macos.conf.json` 的 `signingIdentity: "-"`（ad-hoc），每次构建 cdhash 都变。updater 一换 `.app`，旧授权静默作废，用户不开设置完全无感。

前台 1Hz 不依赖该权限，所以仪表盘还有时间块，但活跃分钟不涨——看起来像「统计坏了」，其实是 count 喂不进去。

空闲秒数 API 不需要任何授权（Stretchly / Electron `powerMonitor.getSystemIdleTime` 同款）。用它喂**现有** `count` 语义，久坐/仪表盘整条链路不用改。辅助功能只影响按键次数等增强项。

## 不要做的

- 不要在未授权时继续只靠 `device_query` 空转等用户自己找设置
- 不要把兜底采样和完整采样叠着跑（会把 count 加倍）
- 不要把「未授权」写成产品缺陷；自开调试视图、用户没勾权限，都不是 bug
- 不要在没付费 Apple Developer ID 的情况下承诺「更新后不用再授权」——那是签名根治，见 [macos-accessibility-permission.md](../../reference/macos-accessibility-permission.md)

已知取舍：未授权期间 `key_count` / 键序列为 0。根治要稳定 Developer ID + 公证。

复现与合入：[#74](https://github.com/lanxiuyun/Catrace/pull/74) / `d480ff0`。见 [bug 记录](../../bugs/2026-09-19-macOS更新后辅助功能授权失效导致一直休息.md)。
