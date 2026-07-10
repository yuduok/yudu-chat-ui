use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod commands;
mod state;

use state::SidecarState;

const EARLY_EXIT_WINDOW: Duration = Duration::from_secs(10);
const MAX_STARTUP_RESTARTS: usize = 1;

fn spawn_sidecar(
    app: &AppHandle,
    state: &SidecarState,
    data_dir: &Path,
    port: u16,
) -> Result<(Receiver<CommandEvent>, CommandChild), String> {
    let bin_name = commands::sidecar_binary_name();
    app.shell()
        .sidecar(&bin_name)
        .map_err(|error| format!("sidecar lookup: {error}"))?
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("YUDU_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("YUDU_DESKTOP", "1")
        .env("YUDU_HEALTH_TOKEN", state.health_token())
        .spawn()
        .map_err(|error| format!("sidecar spawn: {error}"))
}

async fn monitor_sidecar(
    app: AppHandle,
    state: SidecarState,
    data_dir: PathBuf,
    mut receiver: Receiver<CommandEvent>,
) {
    let mut started_at = Instant::now();
    let mut restarts_remaining = MAX_STARTUP_RESTARTS;

    loop {
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    eprintln!("[server stdout] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[server stderr] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(error) => {
                    eprintln!("[server] process error: {error}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[server] terminated: {:?}", payload);
                    break;
                }
                _ => {}
            }
        }

        if let Ok(mut child) = state.child.lock() {
            *child = None;
        }
        if state.is_stopping()
            || restarts_remaining == 0
            || started_at.elapsed() > EARLY_EXIT_WINDOW
        {
            break;
        }

        let port = match state::available_loopback_port() {
            Ok(port) => port,
            Err(error) => {
                eprintln!("[server] failed to select a retry port: {error}");
                break;
            }
        };
        state.set_port(port);
        match spawn_sidecar(&app, &state, &data_dir, port) {
            Ok((next_receiver, child)) => {
                let mut guard = match state.child.lock() {
                    Ok(guard) => guard,
                    Err(_) => {
                        let _ = child.kill();
                        break;
                    }
                };
                // CloseRequested marks `stopping` before taking this mutex.
                // Re-check while holding it so a retry cannot be installed
                // after shutdown observed an empty child slot.
                if state.is_stopping() {
                    drop(guard);
                    let _ = child.kill();
                    break;
                }
                *guard = Some(child);
                drop(guard);
                receiver = next_receiver;
                started_at = Instant::now();
                restarts_remaining -= 1;
                eprintln!("[server] restarted on loopback port {port}");
            }
            Err(error) => {
                eprintln!("[server] retry failed: {error}");
                break;
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Web development keeps the documented 8787 backend. Release builds
    // choose a free loopback port and expose it through `server_status`, avoiding
    // the fixed-port collision with unrelated local services.
    let sidecar_port = if cfg!(debug_assertions) {
        8787
    } else {
        state::available_loopback_port().unwrap_or(8787)
    };
    let health_token = if cfg!(debug_assertions) {
        String::new()
    } else {
        state::generate_health_token().expect("failed to generate the desktop sidecar health token")
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(SidecarState::new(
            sidecar_port,
            health_token,
            !cfg!(debug_assertions),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 在 release 模式下自动拉起 sidecar;dev 模式由 beforeDevCommand 启动 vite,
            // 由用户单独跑 pnpm dev:server 启动后端,方便调试。
            if !cfg!(debug_assertions) {
                let sidecar_state = app.state::<SidecarState>().inner().clone();
                let port = sidecar_state.port();
                let data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("resolve app_data_dir: {e}"))?;
                std::fs::create_dir_all(&data_dir).ok();

                // sidecar 二进制位于 Tauri 资源目录,文件名带平台后缀
                let (receiver, child) =
                    spawn_sidecar(app.handle(), &sidecar_state, &data_dir, port)?;
                let mut guard = sidecar_state
                    .child
                    .lock()
                    .map_err(|_| "sidecar state lock poisoned")?;
                *guard = Some(child);
                drop(guard);

                tauri::async_runtime::spawn(monitor_sidecar(
                    app.handle().clone(),
                    sidecar_state,
                    data_dir,
                    receiver,
                ));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    state.mark_stopping();
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
        .run(tauri::generate_context!())
        .expect("error while running Yudu Chat");
}

#[allow(dead_code)]
type Child = CommandChild;
