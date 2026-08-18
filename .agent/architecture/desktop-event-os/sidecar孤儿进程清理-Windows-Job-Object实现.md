# sidecar 孤儿进程清理 — Windows Job Object（KILL_ON_JOB_CLOSE）实现

> 设计真源 / 实现：2026-08-08。对应 bug：[../../bugs/2026-08-08-sidecar孤儿进程占用端口不随宿主退出释放.md](../../bugs/2026-08-08-sidecar孤儿进程占用端口不随宿主退出释放.md)
> 上级文档：[plugin-native-sidecar-runtime.md](plugin-native-sidecar-runtime.md)

## 一句话

宿主 spawn 的每个 sidecar 都放进一个设了 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job Object，Catrace 进程一退出（包括崩溃/强杀/更新重启），OS 自动杀掉 job 内整棵进程树，孤儿进程不再残留、不再占端口。

## 为什么需要

Windows 上父进程退出**不会自动回收子进程**。宿主正常退出走 `Drop` → `stop_sidecar`（`shutdown` + `taskkill /T /F`）可以清干净；但崩溃 / 强杀 / 更新重启时 `Drop` 不执行，node sidecar 成为孤儿继续监听端口（如 smsforwarder-notify 的 17890）。插件侧的 `freePort()` 只在自身 bind 撞 `EADDRINUSE` 时兜底，disable 时插件已死，救不了自己。

→ 治本必须在宿主：sidecar 生命周期归宿主管，且要覆盖「宿主怎么死」的所有路径。

## 实现（`src-tauri/src/plugin_sidecar.rs`）

### 依赖

`Cargo.toml` 的 `[target.'cfg(windows)'.dependencies]` 的 `windows` 特征加：

- `Win32_System_JobObjects`
- `Win32_Security`（`CreateJobObjectW` 的签名引用 `SECURITY_ATTRIBUTES`，即使传 `None` 也需要该 feature 才编译）

### `SidecarJob`（RAII 句柄）

```rust
#[cfg(windows)]
struct SidecarJob(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for SidecarJob {}
#[cfg(windows)]
unsafe impl Sync for SidecarJob {}

impl SidecarJob {
    fn create_and_assign(child: &Child) -> Option<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
            JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                size,
            )
            .is_err()
            {
                let _ = CloseHandle(job);
                return None;
            }
            let process_handle = HANDLE(child.as_raw_handle());
            if AssignProcessToJobObject(job, process_handle).is_err() {
                let _ = CloseHandle(job);
                return None;
            }
            Some(Self(job))
        }
    }
}

impl Drop for SidecarJob {
    fn drop(&mut self) {
        unsafe { let _ = CloseHandle(self.0); }
    }
}
```

### 接线

- `RunningSidecar` / `SpawnedSidecar` 各加 `#[cfg(windows)] job: Option<SidecarJob>` 字段。
- `spawn_sidecar` 里 `SidecarJob::create_and_assign(&child)`；成功打 `log_info`，失败打 `log_warn`（降级：仅失去孤儿兜底，`taskkill /T /F` 仍在）。
- `job` 字段只为 RAII 持有，加上 `#[allow(dead_code)]`（“held for RAII: closing it on drop kills the job tree”）。
- 非 Windows：字段与逻辑整体 `#[cfg(windows)]` 隔离，不编译。

## 关键点 / 坑

1. **`HANDLE` 不实现 `Send/Sync`**：`RunningSidecar` 在 `PluginSidecarManager` 的 `Mutex<HashMap>` 里跨线程，不补 `unsafe impl Send/Sync` 会直接编译失败。Windows 内核句柄本身线程安全，move/close 跨线程没问题，补是合理的。
2. **`AssignProcessToJobObject` 会失败的情况**：进程已被其它 job 管理（如外部启动器已把进程放 job 里）。此时**降级不阻断**：关掉句柄、`log_warn`、继续原逻辑。
3. **`Drop` 时机与 kill 顺序**：正常 stop 时先 `shutdown` + `taskkill /T /F` 杀完，再随 `RunningSidecar` 析构关 job 句柄——job 里已无进程，关句柄是空操作。异常退出时由 OS 关闭句柄触发杀树，二者不冲突。
4. **`windows` crate 0.61 API 形态**：`CreateJobObjectW` 返回 `Result<HANDLE>`；`JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default()` 可用；`HANDLE = *mut c_void` 可 `HANDLE(child.as_raw_handle())` 转换。
5. **跨平台**：全部 `#[cfg(windows)]`；macOS/Linux 维持 `child.kill()` / `kill_process_tree` 原逻辑（macOS 有进程组语义可另议，暂无改动）。

## 与插件侧 `freePort()` 的分工

| 层 | 机制 | 覆盖 |
|----|------|------|
| 宿主 | Job Object `KILL_ON_JOB_CLOSE` | 宿主任何退出路径 → 自动杀 sidecar 整树 |
| 宿主 | `stop_sidecar`（shutdown + taskkill /T /F） | disable / reload / 正常退出 |
| 插件 | `freePort()`（EADDRINUSE 兜底） | 历史遗留孤儿占端口时新进程自清 |

## 涉及文件

- `src-tauri/Cargo.toml`
- `src-tauri/src/plugin_sidecar.rs`
