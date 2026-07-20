# rdev 弃用 → device_query 统一

## 背景

项目最初在 macOS 和 Windows/Linux 上使用不同的键盘监听方案：

| 平台 | 方案 | 原因 |
|------|------|------|
| Windows/Linux | `rdev::listen()` | 最初选择 |
| macOS | `device_query::on_key_down()` | rdev 在 macOS 非主线程调用 `TISGetInputSourceProperty` 会崩溃 |

## 问题

`rdev` 在 Windows 上通过 `SetWindowsHookEx(WH_KEYBOARD_LL)` 安装全局低层键盘钩子。其钩子链实现在与其他应用（如 Electron 的 Cherry Studio）同时运行时，会导致 Ctrl 修饰键"卡住"——用户释放 Ctrl 后系统仍认为其按下，滚轮滚动被错误解释为 Ctrl+Wheel 缩放。

这并非 Catrace 独有问题，而是 `rdev` 0.5.x 的已知缺陷：修饰键的 KeyRelease 消息在钩子链传递中被吞掉，系统状态与实际不一致。

## 决策

**移除 `rdev`，全平台统一使用 `device_query::DeviceState::on_key_down()`。**

理由：
1. `device_query` Windows 实现不依赖 `SetWindowsHookEx`，不会干扰修饰键
2. macOS 已在用 `device_query`，统一后消除两套代码路径
3. `device_query` 1.1.3 在所有目标平台（Windows/macOS/Linux）均可用
4. 项目仅需检测按键是否发生，不需要 rdev 的字符解析能力

## 影响

- 删除 `rdev` crate 依赖及相关间接依赖（cocoa、core-graphics 0.19/0.21、x11 等）
- 移除 `#[cfg]` 条件编译分支，键盘监听代码统一为一份

## 修订备注（2026-07-20）

统一用 `device_query` **crate** 的决策仍成立（避免 rdev 全局钩子）。  
但 **`DeviceEvents`/`on_key_down` 不适合常驻**：Windows 100µs 轮询导致空闲 CPU 过高。  
常驻键盘改为 `get_keys()` 自管 50ms 边沿采样，见 bug `2026-07-20-idle-cpu-过高-device-events-百分之一百微秒轮询.md`。

