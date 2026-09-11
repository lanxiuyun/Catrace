//! Resolve sidecar binaries for GUI-launched apps.
//!
//! macOS Dock / Finder launches with PATH=`/usr/bin:/bin:/usr/sbin:/sbin`,
//! so `command: "node"` in a plugin manifest fails with ENOENT even when
//! Homebrew Node is installed. This module looks up bare command names on
//! PATH plus well-known extra bin dirs, and prepends those dirs onto the
//! child process PATH.

use std::path::{Path, PathBuf};
use std::process::Command;

pub fn resolve_program(command: &str) -> String {
    let p = Path::new(command);
    if p.is_absolute() {
        return command.to_string();
    }
    if command.contains('/') || command.contains('\\') || command.starts_with('.') {
        return command.to_string();
    }
    lookup_program(command)
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
    #[cfg(unix)]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(".local/bin"));
            dirs.push(home.join(".volta/bin"));
            dirs.push(home.join(".fnm/current/bin"));
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
}
