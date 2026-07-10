use serde::Serialize;
use tauri::State;
use tauri_plugin_shell::ShellExt;

use crate::state::SidecarState;

pub fn sidecar_binary_name() -> String {
    // Tauri 会自动附加平台后缀(如 .exe / -x86_64-pc-windows-msvc / -aarch64-apple-darwin)
    // 这里只返回 stem。
    "binaries/yudu-server".to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub health_token: String,
}

#[tauri::command]
pub fn server_status(state: State<SidecarState>) -> ServerStatus {
    ServerStatus {
        running: state.is_running(),
        port: state.port(),
        health_token: state.health_token().to_string(),
    }
}

#[tauri::command]
pub fn server_port(state: State<SidecarState>) -> u16 {
    state.port()
}

#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // 仅允许 http(s)
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) urls are allowed".into());
    }
    app.shell().open(url, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    // 占位实现:在 macOS 上用 `open -R`,Windows 上用 `explorer`,
    // Linux 用 `xdg-open` 打开父目录。用于在 UI 中打开数据目录。
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
