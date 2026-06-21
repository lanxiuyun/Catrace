use crate::db::Db;

#[derive(serde::Serialize, Clone, Debug)]
pub struct AudioSessionInfo {
    pub pid: u32,
    pub process_name: String,
    pub process_path: String,
    pub peak: f32,
    #[serde(default)]
    pub whitelisted: bool,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::{Interface, PWSTR};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    pub fn list_audio_sessions() -> Result<Vec<AudioSessionInfo>, String> {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let _com_guard = ComGuard;
            if hr.is_err() {
                return Err(format!("CoInitializeEx failed: {:?}", hr));
            }

            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance MMDeviceEnumerator failed: {}", e))?;

            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("GetDefaultAudioEndpoint failed: {}", e))?;

            let session_manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioSessionManager2 failed: {}", e))?;

            let session_enum = session_manager
                .GetSessionEnumerator()
                .map_err(|e| format!("GetSessionEnumerator failed: {}", e))?;

            let count = session_enum
                .GetCount()
                .map_err(|e| format!("GetCount failed: {}", e))?;

            let mut result = Vec::new();
            for i in 0..count {
                let session_control: IAudioSessionControl = match session_enum.GetSession(i) {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                let session_control2: IAudioSessionControl2 = match session_control.cast() {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                let pid = match session_control2.GetProcessId() {
                    Ok(pid) => pid,
                    Err(_) => continue,
                };

                let meter: IAudioMeterInformation = match session_control.cast() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let peak = match meter.GetPeakValue() {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                if peak > 0.0 {
                    let (process_name, process_path) =
                        get_process_info_by_pid(pid).unwrap_or_else(|| {
                            (format!("<pid {}>", pid), String::new())
                        });
                    result.push(AudioSessionInfo {
                        pid,
                        process_name,
                        process_path,
                        peak,
                        whitelisted: false,
                    });
                }
            }

            Ok(result)
        }
    }

    fn get_process_info_by_pid(pid: u32) -> Option<(String, String)> {
        // 首选：用进程句柄拿名字和完整路径
        if let Some((name, path)) = get_process_info_by_handle(pid) {
            if !name.is_empty() {
                return Some((name, path));
            }
        }

        // 兜底：Toolhelp32 快照，对受保护进程（如 audiodg）通常仍能拿到进程名
        let name = get_process_name_by_pid_toolhelp(pid)?;
        Some((name, String::new()))
    }

    fn get_process_info_by_handle(pid: u32) -> Option<(String, String)> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let name = get_process_name_from_handle(handle).unwrap_or_default();
            let path = get_process_path_from_handle(handle).unwrap_or_default();
            Some((name, path))
        }
    }

    fn get_process_name_by_pid_toolhelp(pid: u32) -> Option<String> {
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    if entry.th32ProcessID == pid {
                        let len = entry
                            .szExeFile
                            .iter()
                            .position(|&c| c == 0)
                            .unwrap_or(entry.szExeFile.len());
                        return Some(
                            OsString::from_wide(&entry.szExeFile[..len])
                                .to_string_lossy()
                                .to_string(),
                        );
                    }
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            None
        }
    }

    fn get_process_name_from_handle(handle: HANDLE) -> Option<String> {
        unsafe {
            let mut buf = [0u16; 512];
            let len = GetModuleBaseNameW(handle, None, &mut buf);
            if len == 0 {
                return None;
            }
            let os_string = OsString::from_wide(&buf[..len as usize]);
            Some(os_string.to_string_lossy().to_string())
        }
    }

    fn get_process_path_from_handle(handle: HANDLE) -> Option<String> {
        unsafe {
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let path_ptr = PWSTR::from_raw(buf.as_mut_ptr());
            QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, path_ptr, &mut size).ok()?;
            if size == 0 {
                return None;
            }
            let os_string = OsString::from_wide(&buf[..size as usize]);
            Some(os_string.to_string_lossy().to_string())
        }
    }

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn list_audio_sessions() -> Result<Vec<AudioSessionInfo>, String> {
        Err("Audio session detection is only available on Windows".to_string())
    }
}

pub fn list_audio_sessions() -> Result<Vec<AudioSessionInfo>, String> {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel();
    std::thread::Builder::new()
        .name("audio-session-check".into())
        .spawn(move || {
            let result = imp::list_audio_sessions();
            let _ = tx.send(result);
        })
        .map_err(|e| format!("无法创建音频检测线程: {}", e))?;

    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(result) => result,
        Err(_) => Err("音频会话查询超时".into()),
    }
}

fn is_path_match(path_lower: &str, item_lower: &str) -> bool {
    if path_lower == item_lower {
        return true;
    }
    if path_lower.ends_with(item_lower) {
        return true;
    }
    if path_lower.starts_with(item_lower) {
        let rest = &path_lower[item_lower.len()..];
        // 白名单项是目录前缀：路径接下来是反斜杠，或白名单项本身以反斜杠结尾
        if rest.starts_with('\\') || item_lower.ends_with('\\') || rest.is_empty() {
            return true;
        }
    }
    false
}

pub fn is_session_whitelisted(session: &AudioSessionInfo, whitelist: &[String]) -> bool {
    if session.process_name.is_empty() && session.process_path.is_empty() {
        return false;
    }

    whitelist.iter().any(|w| {
        let w = w.trim();
        if w.is_empty() {
            return false;
        }

        // 1) 进程名精确匹配（不区分大小写）
        if session.process_name.eq_ignore_ascii_case(w) {
            return true;
        }

        // 2) 进程路径匹配：完整路径相等、以白名单项结尾，或是白名单项所在目录
        if !session.process_path.is_empty() {
            let path_lower = session.process_path.to_lowercase();
            let item_lower = w.to_lowercase();
            if is_path_match(&path_lower, &item_lower) {
                return true;
            }

            // 允许用户用正斜杠写路径
            let item_normalized = item_lower.replace('/', "\\");
            if item_normalized != item_lower && is_path_match(&path_lower, &item_normalized) {
                return true;
            }
        }

        false
    })
}

fn is_any_session_active(sessions: &[AudioSessionInfo], whitelist: &[String]) -> bool {
    sessions
        .iter()
        .any(|session| session.peak > 0.0 && !is_session_whitelisted(session, whitelist))
}

pub fn is_media_audio_active(whitelist: &[String]) -> bool {
    match list_audio_sessions() {
        Ok(sessions) => is_any_session_active(&sessions, whitelist),
        Err(_) => false,
    }
}

pub fn default_whitelist() -> Vec<String> {
    [
        "svchost.exe",
        "explorer.exe",
        "shellexperiencehost.exe",
        "audiodg.exe",
        "dwm.exe",
        "csrss.exe",
        "services.exe",
        "winlogon.exe",
        "searchindexer.exe",
        "runtimebroker.exe",
        "catrace.exe",
        "catrace_lib.dll",
    ]
    .into_iter()
    .map(|s| s.to_string())
    .collect()
}

pub fn load_whitelist(db: &Db) -> Vec<String> {
    let raw = db.get_setting("media_whitelist", "");
    if raw.is_empty() {
        return save_default_whitelist(db);
    }
    if let Ok(list) = serde_json::from_str::<Vec<String>>(&raw) {
        return list;
    }
    save_default_whitelist(db)
}

fn save_default_whitelist(db: &Db) -> Vec<String> {
    let defaults = default_whitelist();
    if let Ok(json) = serde_json::to_string(&defaults) {
        let _ = db.set_setting("media_whitelist", &json);
    }
    defaults
}

pub fn save_whitelist(db: &Db, list: &[String]) -> Result<(), String> {
    let json = serde_json::to_string(list).map_err(|e| e.to_string())?;
    db.set_setting("media_whitelist", &json)
        .map_err(|e| e.to_string())
}

pub fn parse_whitelist_text(text: &str) -> Vec<String> {
    text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.to_string())
        .collect()
}

pub fn whitelist_to_text(list: &[String]) -> String {
    list.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_any_session_active_respects_whitelist() {
        let sessions = vec![
            AudioSessionInfo {
                pid: 1,
                process_name: "chrome.exe".to_string(),
                process_path: r"C:\Program Files\Google\Chrome\chrome.exe".to_string(),
                peak: 0.5,
                whitelisted: false,
            },
            AudioSessionInfo {
                pid: 2,
                process_name: "Svchost.exe".to_string(),
                process_path: r"C:\Windows\System32\svchost.exe".to_string(),
                peak: 0.1,
                whitelisted: false,
            },
        ];
        let whitelist = vec!["svchost.exe".to_string()];
        assert!(is_any_session_active(&sessions, &whitelist));
    }

    #[test]
    fn test_is_any_session_active_all_whitelisted() {
        let sessions = vec![AudioSessionInfo {
            pid: 2,
            process_name: "svchost.exe".to_string(),
            process_path: r"C:\Windows\System32\svchost.exe".to_string(),
            peak: 0.1,
            whitelisted: false,
        }];
        let whitelist = vec!["svchost.exe".to_string()];
        assert!(!is_any_session_active(&sessions, &whitelist));
    }

    #[test]
    fn test_is_any_session_active_whitelisted_by_path() {
        let sessions = vec![AudioSessionInfo {
            pid: 1,
            process_name: "chrome.exe".to_string(),
            process_path: r"C:\Program Files\Google\Chrome\chrome.exe".to_string(),
            peak: 0.5,
            whitelisted: false,
        }];
        // 用完整路径或路径后缀都能命中白名单
        let whitelist = vec![r"C:\Program Files\Google\Chrome".to_string()];
        assert!(!is_any_session_active(&sessions, &whitelist));
    }

    #[test]
    fn test_is_any_session_active_no_sound() {
        let sessions = vec![AudioSessionInfo {
            pid: 1,
            process_name: "chrome.exe".to_string(),
            process_path: r"C:\Program Files\Google\Chrome\chrome.exe".to_string(),
            peak: 0.0,
            whitelisted: false,
        }];
        let whitelist: Vec<String> = vec![];
        assert!(!is_any_session_active(&sessions, &whitelist));
    }

    #[test]
    fn test_parse_whitelist_text_ignores_comments_and_empty() {
        let text = "chrome.exe\n\n# comment\nexplorer.exe";
        let list = parse_whitelist_text(text);
        assert_eq!(list, vec!["chrome.exe", "explorer.exe"]);
    }
}
