use tauri::{Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod commands;
mod state;

use state::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 在 release 模式下自动拉起 sidecar;dev 模式由 beforeDevCommand 启动 vite,
            // 由用户单独跑 pnpm dev:server 启动后端,方便调试。
            if !cfg!(debug_assertions) {
                let sidecar_state: State<SidecarState> = app.state();
                let port = sidecar_state.port;
                let data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("resolve app_data_dir: {e}"))?;
                std::fs::create_dir_all(&data_dir).ok();

                // sidecar 二进制位于 Tauri 资源目录,文件名带平台后缀
                let bin_name = commands::sidecar_binary_name();
                let sidecar = app
                    .shell()
                    .sidecar(&bin_name)
                    .map_err(|e| format!("sidecar lookup: {e}"))?
                    .env("PORT", port.to_string())
                    .env("HOST", "127.0.0.1")
                    .env("YUDU_DATA_DIR", data_dir.to_string_lossy().to_string())
                    .env("YUDU_DESKTOP", "1");

                let (mut rx, child) = sidecar
                    .spawn()
                    .map_err(|e| format!("sidecar spawn: {e}"))?;

                let state_clone = app.state::<SidecarState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(bytes) => {
                                eprintln!("[server stdout] {}", String::from_utf8_lossy(&bytes));
                            }
                            CommandEvent::Stderr(bytes) => {
                                eprintln!("[server stderr] {}", String::from_utf8_lossy(&bytes));
                            }
                            CommandEvent::Terminated(payload) => {
                                eprintln!("[server] terminated: {:?}", payload);
                                break;
                            }
                            _ => {}
                        }
                    }
                    let _ = state_clone;
                });

                let mut guard = sidecar_state.child.lock().unwrap();
                *guard = Some(child);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::server_status,
            commands::server_port,
            commands::open_external,
            commands::reveal_in_finder,
        ])
        .manage(SidecarState::default())
        .run(tauri::generate_context!())
        .expect("error while running Yudu Chat");
}

#[allow(dead_code)]
type Child = CommandChild;
