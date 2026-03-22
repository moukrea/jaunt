use jaunt_protocol::messages::*;
use std::process::Command;

pub struct SnagBridge {
    snag_path: String,
}

impl SnagBridge {
    pub fn new() -> Self {
        let snag_path = which_snag().unwrap_or_else(|| "snag".to_string());
        Self { snag_path }
    }

    pub fn check_available(&self) -> Result<(), String> {
        Command::new(&self.snag_path)
            .arg("--version")
            .output()
            .map_err(|e| format!("snag not found: {e}. Install snag first."))?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let output = Command::new(&self.snag_path)
            .args(["list", "--json"])
            .output()
            .map_err(|e| format!("snag list failed: {e}"))?;

        if !output.status.success() {
            return Ok(Vec::new());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("parse error: {e}"))?;

        let sessions = parsed["sessions"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        Some(SessionInfo {
                            id: v["id"].as_str()?.to_string(),
                            name: v["name"].as_str().map(|s| s.to_string()),
                            shell: v["shell"].as_str().unwrap_or("?").to_string(),
                            cwd: v["cwd"].as_str().unwrap_or("?").to_string(),
                            state: v["state"].as_str().unwrap_or("?").to_string(),
                            fg_process: v["fg_process"].as_str().map(|s| s.to_string()),
                            attached: v["attached"].as_u64().unwrap_or(0) as usize,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(sessions)
    }

    pub fn create_session(
        &self,
        shell: Option<&str>,
        name: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<String, String> {
        let mut cmd = Command::new(&self.snag_path);
        cmd.arg("new");
        if let Some(s) = shell {
            cmd.args(["--shell", s]);
        }
        if let Some(n) = name {
            cmd.args(["--name", n]);
        }
        if let Some(c) = cwd {
            cmd.args(["--cwd", c]);
        }

        let output = cmd.output().map_err(|e| format!("snag new failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag new failed: {stderr}"));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn kill_session(&self, target: &str) -> Result<(), String> {
        let output = Command::new(&self.snag_path)
            .args(["kill", target])
            .output()
            .map_err(|e| format!("snag kill failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag kill failed: {stderr}"));
        }
        Ok(())
    }

    pub fn send_input(&self, target: &str, input: &str) -> Result<(), String> {
        let output = Command::new(&self.snag_path)
            .args(["send", target, input])
            .output()
            .map_err(|e| format!("snag send failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag send failed: {stderr}"));
        }
        Ok(())
    }

    pub fn session_info(&self, target: &str) -> Result<SessionInfo, String> {
        let output = Command::new(&self.snag_path)
            .args(["info", target, "--json"])
            .output()
            .map_err(|e| format!("snag info failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag info failed: {stderr}"));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let v: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("parse error: {e}"))?;
        Ok(SessionInfo {
            id: v["id"].as_str().unwrap_or("?").to_string(),
            name: v["name"].as_str().map(|s| s.to_string()),
            shell: v["shell"].as_str().unwrap_or("?").to_string(),
            cwd: v["cwd"].as_str().unwrap_or("?").to_string(),
            state: v["state"].as_str().unwrap_or("?").to_string(),
            fg_process: v["fg_process"].as_str().map(|s| s.to_string()),
            attached: v["attached"].as_u64().unwrap_or(0) as usize,
        })
    }

    pub fn rename_session(&self, target: &str, new_name: &str) -> Result<(), String> {
        let output = Command::new(&self.snag_path)
            .args(["rename", target, new_name])
            .output()
            .map_err(|e| format!("snag rename failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag rename failed: {stderr}"));
        }
        Ok(())
    }
}

fn which_snag() -> Option<String> {
    Command::new("which")
        .arg("snag")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}
