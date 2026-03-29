//! PID file management for single-instance enforcement.

use std::fs;
use std::path::PathBuf;

/// Get the PID file path.
/// Prefers $XDG_RUNTIME_DIR, falls back to ~/.config/jaunt/.
fn pid_path() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        PathBuf::from(dir).join("jaunt-host.pid")
    } else {
        crate::config::JauntConfig::config_dir().join("jaunt-host.pid")
    }
}

/// Read PID from the PID file. Returns None if file doesn't exist or is invalid.
fn read_pid() -> Option<u32> {
    fs::read_to_string(pid_path())
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

/// Check if a process with the given PID is alive.
fn is_alive(pid: u32) -> bool {
    // kill(pid, 0) checks if process exists without sending a signal
    nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None).is_ok()
}

/// Acquire the PID lock. Returns Err with message if another instance is running.
pub fn acquire() -> Result<(), String> {
    if let Some(pid) = read_pid() {
        if is_alive(pid) {
            return Err(format!(
                "Another jaunt-host is running (PID {pid}). \
                 Stop it with `jaunt-host stop` or `kill {pid}`."
            ));
        }
        // Stale PID file — remove it
        let _ = fs::remove_file(pid_path());
    }
    write_current();
    Ok(())
}

/// Write the current process PID to the PID file.
pub fn write_current() {
    let path = pid_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, format!("{}", std::process::id()));
}

/// Remove the PID file.
pub fn release() {
    let _ = fs::remove_file(pid_path());
}

/// `jaunt-host stop` — send SIGTERM to the running daemon.
pub fn cmd_stop() {
    match read_pid() {
        Some(pid) if is_alive(pid) => {
            let nix_pid = nix::unistd::Pid::from_raw(pid as i32);
            eprintln!("Stopping jaunt-host (PID {pid})...");
            let _ = nix::sys::signal::kill(nix_pid, nix::sys::signal::Signal::SIGTERM);

            // Wait up to 5 seconds for graceful shutdown
            for _ in 0..50 {
                if !is_alive(pid) {
                    eprintln!("Stopped.");
                    let _ = fs::remove_file(pid_path());
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            // Force kill
            eprintln!("Sending SIGKILL...");
            let _ = nix::sys::signal::kill(nix_pid, nix::sys::signal::Signal::SIGKILL);
            let _ = fs::remove_file(pid_path());
            eprintln!("Killed.");
        }
        Some(_) => {
            eprintln!("jaunt-host is not running (stale PID file). Cleaning up.");
            let _ = fs::remove_file(pid_path());
        }
        None => {
            eprintln!("jaunt-host is not running.");
        }
    }
}

/// `jaunt-host status` — check if daemon is running.
pub fn cmd_status() {
    match read_pid() {
        Some(pid) if is_alive(pid) => {
            println!("jaunt-host is running (PID {pid})");
        }
        Some(_) => {
            println!("jaunt-host is not running (stale PID file)");
            let _ = fs::remove_file(pid_path());
        }
        None => {
            println!("jaunt-host is not running");
        }
    }
}
