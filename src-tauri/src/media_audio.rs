use crate::db::Db;

#[derive(serde::Serialize, Clone, Debug)]
pub struct AudioSessionInfo {
    pub pid: u32,
    pub process_name: String,
    pub peak: f32,
    #[serde(default)]
    pub whitelisted: bool,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

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
                    let process_name =
                        get_process_name_by_pid(pid).unwrap_or_else(|| format!("<pid {}>", pid));
                    result.push(AudioSessionInfo {
                        pid,
                        process_name,
                        peak,
                        whitelisted: false,
                    });
                }
            }

            Ok(result)
        }
    }

    fn get_process_name_by_pid(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 512];
            let len = GetModuleBaseNameW(handle, None, &mut buf);
            // CloseHandle is not strictly required for a pseudo-handle? No, OpenProcess returns real handle.
            // windows crate handle has Drop which calls CloseHandle.
            if len == 0 {
                return None;
            }
            let os_string = OsString::from_wide(&buf[..len as usize]);
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

fn is_any_session_active(sessions: &[AudioSessionInfo], whitelist: &[String]) -> bool {
    sessions.iter().any(|session| {
        session.peak > 0.0
            && !whitelist
                .iter()
                .any(|w| w.eq_ignore_ascii_case(&session.process_name))
    })
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
                peak: 0.5,
                whitelisted: false,
            },
            AudioSessionInfo {
                pid: 2,
                process_name: "Svchost.exe".to_string(),
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
            peak: 0.1,
            whitelisted: false,
        }];
        let whitelist = vec!["svchost.exe".to_string()];
        assert!(!is_any_session_active(&sessions, &whitelist));
    }

    #[test]
    fn test_is_any_session_active_no_sound() {
        let sessions = vec![AudioSessionInfo {
            pid: 1,
            process_name: "chrome.exe".to_string(),
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
