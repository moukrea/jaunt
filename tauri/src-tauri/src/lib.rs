use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

mod cairn_bridge;

// App state shared across Tauri commands
pub struct AppState {
    pub connected: Mutex<bool>,
    pub host_name: Mutex<String>,
    pub peer_id: Mutex<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            connected: Mutex::new(false),
            host_name: Mutex::new(String::new()),
            peer_id: Mutex::new(String::new()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PairResult {
    pub peer_id: String,
    pub host_name: String,
}

#[tauri::command]
async fn pair_with_pin(
    pin: String,
    state: State<'_, AppState>,
) -> Result<PairResult, String> {
    let peer_id = cairn_bridge::pair_pin(&pin).await?;
    *state.connected.lock().unwrap() = true;
    *state.peer_id.lock().unwrap() = peer_id.clone();
    *state.host_name.lock().unwrap() = "Host".to_string();
    Ok(PairResult {
        peer_id,
        host_name: "Host".to_string(),
    })
}

#[tauri::command]
async fn pair_with_link(
    link: String,
    state: State<'_, AppState>,
) -> Result<PairResult, String> {
    let (peer_id, host_name) = cairn_bridge::pair_link(&link).await?;
    *state.connected.lock().unwrap() = true;
    *state.peer_id.lock().unwrap() = peer_id.clone();
    *state.host_name.lock().unwrap() = host_name.clone();
    Ok(PairResult { peer_id, host_name })
}

#[tauri::command]
async fn get_sessions(state: State<'_, AppState>) -> Result<String, String> {
    let peer_id = state.peer_id.lock().unwrap().clone();
    cairn_bridge::get_sessions(&peer_id).await
}

#[tauri::command]
async fn send_command(
    session: String,
    command: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let peer_id = state.peer_id.lock().unwrap().clone();
    cairn_bridge::send_command(&peer_id, &session, &command).await
}

#[tauri::command]
async fn create_session(
    name: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let peer_id = state.peer_id.lock().unwrap().clone();
    cairn_bridge::create_session(&peer_id, name.as_deref()).await
}

#[tauri::command]
async fn kill_session(
    session: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let peer_id = state.peer_id.lock().unwrap().clone();
    cairn_bridge::kill_session(&peer_id, &session).await
}

#[tauri::command]
fn is_connected(state: State<'_, AppState>) -> bool {
    *state.connected.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pair_with_pin,
            pair_with_link,
            get_sessions,
            send_command,
            create_session,
            kill_session,
            is_connected,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
