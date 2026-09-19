//! Resolve sidecar binaries for GUI-launched apps.
//!
//! macOS Dock / Finder launches with PATH=`/usr/bin:/bin:/usr/sbin:/sbin`,
//! so `command: "node"` in a plugin manifest fails with ENOENT even when
//! Homebrew Node is installed. This module looks up bare command names on
//! PATH plus well-known extra bin dirs, and prepends those dirs onto the
//! child process PATH.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// Bin dirs of runtimes managed by the host (e.g. the portable Node.js
/// installed under app_data/runtime/node). Registered during setup, consulted
/// by both `resolve_program` and `prepend_gui_path` so sidecars pick them up
/// without any restart.
static MANAGED_BIN_DIRS: OnceLock<Vec<PathBuf>> = OnceLock::new();

pub fn register_managed_bin_dirs(dirs: Vec<PathBuf>) {
    let _ = MANAGED_BIN_DIRS.set(dirs);
}

/// Locate a bare command across PATH, well-known dirs and host-managed
/// runtime dirs. `None` means "not installed" (e.g. node runtime missing).
pub fn find_program(command: &str) -> Option<PathBuf> {
    lookup_program(command)
}

pub fn resolve_program(command: &str) -> String {
    let p = Path::new(command);
    if p.is_absolute() {
        return command.to_string();
    }
    if command.contains('/') || command.contains('\\') || command.starts_with('.') {
        return command.to_string();
    }
    find_program(command)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| command.to_string())
}

pub fn prepend_gui_path(command: &mut Command) {
    let mut parts: Vec<PathBuf> = extra_bin_dirs();
    if let Ok(path) = std::env::var("PATH") {
        parts.extend(std::env::split_paths(&path));
    }
    command.env("PATH", std::env::join_paths(parts).unwrap_or_default());
}

fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(managed) = MANAGED_BIN_DIRS.get() {
        dirs.extend(managed.iter().cloned());
    }
    #[cfg(unix)]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(".local/bin"));
            dirs.push(home.join(".volta/bin"));
            dirs.extend(fnm_bin_dirs(&home));
            let nvm = home.join(".nvm/versions/node");
            if nvm.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&nvm) {
                    let mut vers: Vec<PathBuf> = entries
                        .flatten()
                        .map(|e| e.path())
                        .filter(|p| p.is_dir())
                        .collect();
                    vers.sort();
                    if let Some(last) = vers.last() {
                        dirs.push(last.join("bin"));
                    }
                }
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            dirs.push(PathBuf::from(pf).join("nodejs"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            dirs.push(local.join("fnm"));
            dirs.push(local.join("Programs").join("nodejs"));
        }
    }
    dirs
}

#[cfg(unix)]
fn fnm_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let fnm_root = home.join(".local/share/fnm");
    let mut dirs = vec![
        home.join(".fnm/current/bin"),
        fnm_root.join("aliases/default/bin"),
    ];
    let versions = fnm_root.join("node-versions");
    if let Ok(entries) = std::fs::read_dir(versions) {
        let mut version_dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path().join("installation/bin"))
            .filter(|path| path.is_dir())
            .collect();
        version_dirs.sort();
        version_dirs.reverse();
        dirs.extend(version_dirs);
    }
    dirs
}

fn lookup_program(command: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.extend(extra_bin_dirs());
    let names: Vec<String> = {
        #[cfg(windows)]
        {
            vec![
                command.to_string(),
                format!("{command}.exe"),
                format!("{command}.cmd"),
            ]
        }
        #[cfg(not(windows))]
        {
            vec![command.to_string()]
        }
    };
    for dir in dirs {
        for name in &names {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_command_is_unchanged() {
        assert_eq!(resolve_program("/usr/bin/node"), "/usr/bin/node");
    }

    #[test]
    fn relative_path_command_is_unchanged() {
        assert_eq!(resolve_program("./runtime/main"), "./runtime/main");
        assert_eq!(resolve_program("bin/node"), "bin/node");
    }

    #[cfg(unix)]
    #[test]
    fn fnm_default_alias_bin_is_discovered() {
        let home = test_home("default-alias");
        let bin = home.join(".local/share/fnm/aliases/default/bin");
        std::fs::create_dir_all(&bin).expect("create fnm alias bin");
        std::fs::write(bin.join("node"), b"").expect("create node fixture");

        let dirs = fnm_bin_dirs(&home);

        assert!(dirs.contains(&bin));
        remove_test_home(&home);
    }

    #[cfg(unix)]
    #[test]
    fn fnm_version_installation_bin_is_discovered() {
        let home = test_home("version-installation");
        let bin = home.join(".local/share/fnm/node-versions/v22.20.0/installation/bin");
        std::fs::create_dir_all(&bin).expect("create fnm version bin");
        std::fs::write(bin.join("node"), b"").expect("create node fixture");

        let dirs = fnm_bin_dirs(&home);

        assert!(dirs.contains(&bin));
        remove_test_home(&home);
    }

    #[cfg(unix)]
    fn test_home(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "catrace-sidecar-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[cfg(unix)]
    fn remove_test_home(path: &std::path::Path) {
        let _ = std::fs::remove_dir_all(path);
    }
}
