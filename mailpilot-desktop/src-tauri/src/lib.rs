use std::{
    env,
    fs::{self, OpenOptions},
    io,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{Manager, RunEvent};

const BACKEND_SOCKET_ADDR: &str = "127.0.0.1:8082";
const BACKEND_JAR_RELATIVE_PATH: &str = "backend/mailpilot-server.jar";
const BACKEND_LOG_FILE_NAME: &str = "backend.out.log";
const BACKEND_ERROR_LOG_FILE_NAME: &str = "backend.err.log";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct ManagedBackendProcess(Mutex<Option<Child>>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn backend_is_running() -> bool {
    let Ok(socket_addr) = BACKEND_SOCKET_ADDR.parse::<SocketAddr>() else {
        return false;
    };

    TcpStream::connect_timeout(&socket_addr, Duration::from_millis(250)).is_ok()
}

fn launch_bundled_backend<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Option<Child>, String> {
    if cfg!(debug_assertions) || backend_is_running() {
        return Ok(None);
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to resolve resource directory: {error}"))?;
    let backend_jar_path = resource_dir.join(BACKEND_JAR_RELATIVE_PATH);
    if !backend_jar_path.exists() {
        return Err(format!(
            "Bundled backend JAR not found at {}",
            backend_jar_path.display()
        ));
    }

    let backend_base_dir = resolve_backend_base_dir(app)?;
    let logs_dir = backend_base_dir.join("logs");
    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("Failed to create backend log directory: {error}"))?;

    for java_binary in java_binary_candidates(&resource_dir) {
        match spawn_backend_process(&java_binary, &backend_jar_path, &backend_base_dir, &logs_dir) {
            Ok(child) => return Ok(Some(child)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to launch bundled backend with {}: {error}",
                    java_binary.display()
                ))
            }
        }
    }

    Err(
        "Unable to locate a Java runtime for the bundled backend. Install Java 21+ or bundle a runtime under backend/runtime."
            .to_string(),
    )
}

fn resolve_backend_base_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    if let Ok(local_data_dir) = app.path().local_data_dir() {
        return Ok(local_data_dir.join("MailPilot"));
    }

    let local_app_data =
        env::var_os("LOCALAPPDATA").ok_or("Failed to resolve LOCALAPPDATA for MailPilot backend.")?;
    Ok(PathBuf::from(local_app_data).join("MailPilot"))
}

fn java_binary_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut push_candidate = |candidate: PathBuf| {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    };

    let bundled_runtime_bin_dir = resource_dir.join("backend").join("runtime").join("bin");

    #[cfg(target_os = "windows")]
    {
        push_candidate(bundled_runtime_bin_dir.join("javaw.exe"));
        push_candidate(bundled_runtime_bin_dir.join("java.exe"));

        if let Some(java_home) = env::var_os("JAVA_HOME") {
            let java_home = PathBuf::from(java_home);
            push_candidate(java_home.join("bin").join("javaw.exe"));
            push_candidate(java_home.join("bin").join("java.exe"));
        }

        push_candidate(PathBuf::from("javaw.exe"));
        push_candidate(PathBuf::from("java.exe"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        push_candidate(bundled_runtime_bin_dir.join("java"));

        if let Some(java_home) = env::var_os("JAVA_HOME") {
            let java_home = PathBuf::from(java_home);
            push_candidate(java_home.join("bin").join("java"));
        }

        push_candidate(PathBuf::from("java"));
    }

    candidates
}

fn spawn_backend_process(
    java_binary: &Path,
    backend_jar_path: &Path,
    backend_base_dir: &Path,
    logs_dir: &Path,
) -> io::Result<Child> {
    let stdout_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_dir.join(BACKEND_LOG_FILE_NAME))?;
    let stderr_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_dir.join(BACKEND_ERROR_LOG_FILE_NAME))?;

    let mut command = Command::new(java_binary);
    command
        .arg(format!(
            "-Dmailpilot.desktop.base-dir={}",
            backend_base_dir.display()
        ))
        .arg("-jar")
        .arg(backend_jar_path)
        .arg("--spring.profiles.active=desktop")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log))
        .current_dir(backend_base_dir);

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    command.spawn()
}

fn stop_bundled_backend<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    let state = app_handle.state::<ManagedBackendProcess>();
    let mut child = state.0.lock().expect("poisoned backend process state");
    if let Some(process) = child.as_mut() {
        let _ = process.kill();
        let _ = process.wait();
    }
    child.take();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ManagedBackendProcess::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            match launch_bundled_backend(&app.handle()) {
                Ok(Some(child)) => {
                    let state = app.state::<ManagedBackendProcess>();
                    *state.0.lock().expect("poisoned backend process state") = Some(child);
                }
                Ok(None) => {}
                Err(error) => eprintln!("MailPilot backend launch skipped: {error}"),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_bundled_backend(app_handle);
        }
    });
}
