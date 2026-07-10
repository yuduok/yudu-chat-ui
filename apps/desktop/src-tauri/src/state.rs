use std::fmt::Write as _;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::{io, net::TcpListener};
use tauri_plugin_shell::process::CommandChild;

#[derive(Clone)]
pub struct SidecarState {
    pub child: Arc<Mutex<Option<CommandChild>>>,
    port: Arc<AtomicU16>,
    health_token: Arc<str>,
    managed_sidecar: bool,
    stopping: Arc<AtomicBool>,
}

impl SidecarState {
    pub fn new(port: u16, health_token: String, managed_sidecar: bool) -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            port: Arc::new(AtomicU16::new(port)),
            health_token: Arc::from(health_token),
            managed_sidecar,
            stopping: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Acquire)
    }

    pub fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::Release);
    }

    pub fn health_token(&self) -> &str {
        self.health_token.as_ref()
    }

    pub fn is_running(&self) -> bool {
        if !self.managed_sidecar {
            return true;
        }
        self.child
            .lock()
            .ok()
            .map(|child| child.is_some())
            .unwrap_or(false)
    }

    pub fn mark_stopping(&self) {
        self.stopping.store(true, Ordering::Release);
    }

    pub fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }
}

pub fn available_loopback_port() -> io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

pub fn generate_health_token() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)?;
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut token, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(token)
}
