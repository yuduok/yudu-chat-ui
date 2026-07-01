use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;

#[derive(Default, Clone)]
pub struct SidecarState {
    pub child: Arc<Mutex<Option<CommandChild>>>,
    pub port: u16,
}
