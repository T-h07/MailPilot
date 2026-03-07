use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{Manager, RunEvent};

const BACKEND_SOCKET_ADDR: &str = "127.0.0.1:8082";
const BACKEND_JAR_RELATIVE_PATH: &str = "backend/mailpilot-server.jar";
const BACKEND_LOG_FILE_NAME: &str = "backend.out.log";
const BACKEND_ERROR_LOG_FILE_NAME: &str = "backend.err.log";
const BACKEND_LAUNCH_ERROR_FILE_NAME: &str = "backend-launch-error.log";
const BACKEND_HEALTH_REQUEST: &str =
    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
const BACKEND_STARTUP_POLL_ATTEMPTS: usize = 20;
const BACKEND_STARTUP_POLL_DELAY_MS: u64 = 500;
const MINIMUM_JAVA_MAJOR_VERSION: u32 = 21;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct ManagedBackendProcess(Mutex<Option<Child>>);

#[derive(Default)]
struct BackendLaunchStatus(Mutex<Option<String>>);

enum BackendHealthStatus {
    Healthy,
    Occupied,
    Unreachable,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_backend_launch_error(state: tauri::State<'_, BackendLaunchStatus>) -> Option<String> {
    state
        .0
        .lock()
        .expect("poisoned backend launch state")
        .clone()
}

fn backend_health_status() -> BackendHealthStatus {
    let Ok(socket_addr) = BACKEND_SOCKET_ADDR.parse::<SocketAddr>() else {
        return BackendHealthStatus::Unreachable;
    };

    let Ok(mut stream) = TcpStream::connect_timeout(&socket_addr, Duration::from_millis(250))
    else {
        return BackendHealthStatus::Unreachable;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1000)));

    if stream.write_all(BACKEND_HEALTH_REQUEST.as_bytes()).is_err() {
        return BackendHealthStatus::Occupied;
    }

    let mut response = Vec::new();
    if stream.read_to_end(&mut response).is_err() {
        return BackendHealthStatus::Occupied;
    }

    let response = String::from_utf8_lossy(&response);
    if (response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200"))
        && response.contains("\"status\":\"ok\"")
        && response.contains("\"app\":\"MailPilot\"")
    {
        return BackendHealthStatus::Healthy;
    }

    BackendHealthStatus::Occupied
}

fn launch_bundled_backend<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Option<Child>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }

    match backend_health_status() {
        BackendHealthStatus::Healthy => return Ok(None),
        BackendHealthStatus::Occupied => {
            return Err(
                "MailPilot could not start its bundled backend because 127.0.0.1:8082 is already in use by another process. Stop that process and relaunch MailPilot."
                    .to_string(),
            )
        }
        BackendHealthStatus::Unreachable => {}
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

    let mut last_error = None;
    for java_binary in java_binary_candidates(&resource_dir) {
        match java_binary_meets_minimum_version(&java_binary) {
            Ok(true) => {}
            Ok(false) => {
                last_error = Some(format!(
                    "MailPilot requires Java {MINIMUM_JAVA_MAJOR_VERSION}+ but found an older runtime at {}.",
                    java_binary.display()
                ));
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                last_error = Some(format!(
                    "Failed to inspect the Java runtime at {}: {error}",
                    java_binary.display()
                ));
                continue;
            }
        }

        match spawn_backend_process(
            &java_binary,
            &backend_jar_path,
            &backend_base_dir,
            &logs_dir,
        ) {
            Ok(mut child) => match wait_for_backend_start(&mut child) {
                Ok(()) => return Ok(Some(child)),
                Err(error) => {
                    terminate_child(&mut child);
                    last_error = Some(format!(
                        "Failed to launch MailPilot's bundled backend with {}: {error}",
                        java_binary.display()
                    ));
                }
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                last_error = Some(format!(
                    "Failed to launch bundled backend with {}: {error}",
                    java_binary.display()
                ));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        "Unable to locate a Java runtime for the bundled backend. Install Java 21+ or bundle a runtime under backend/runtime."
            .to_string()
    }))
}

fn resolve_backend_base_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    if let Ok(local_data_dir) = app.path().local_data_dir() {
        return Ok(local_data_dir.join("MailPilot"));
    }

    let local_app_data = env::var_os("LOCALAPPDATA")
        .ok_or("Failed to resolve LOCALAPPDATA for MailPilot backend.")?;
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
        push_candidate(bundled_runtime_bin_dir.join("java.exe"));

        if let Some(java_home) = env::var_os("JAVA_HOME") {
            let java_home = PathBuf::from(java_home);
            push_candidate(java_home.join("bin").join("java.exe"));
        }

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

fn java_binary_meets_minimum_version(java_binary: &Path) -> io::Result<bool> {
    let mut command = Command::new(java_binary);
    command.arg("-version");

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output()?;
    let version_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let Some(major_version) = parse_java_major_version(&version_output) else {
        return Ok(false);
    };

    Ok(major_version >= MINIMUM_JAVA_MAJOR_VERSION)
}

fn parse_java_major_version(version_output: &str) -> Option<u32> {
    let version_string = version_output.split('"').nth(1)?;
    let mut version_parts = version_string.split('.');
    let first_part = version_parts.next()?;
    if first_part == "1" {
        return version_parts.next()?.parse().ok();
    }

    first_part.parse().ok()
}

fn wait_for_backend_start(child: &mut Child) -> Result<(), String> {
    for _ in 0..BACKEND_STARTUP_POLL_ATTEMPTS {
        match backend_health_status() {
            BackendHealthStatus::Healthy => return Ok(()),
            BackendHealthStatus::Occupied => {
                return Err(
                    "127.0.0.1:8082 is occupied by another process or an unhealthy service. Stop the process using that port and retry."
                        .to_string(),
                )
            }
            BackendHealthStatus::Unreachable => {}
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "The Java process exited early with status {status}. Check %LOCALAPPDATA%\\MailPilot\\logs\\backend.err.log."
                ))
            }
            Ok(None) => {}
            Err(error) => {
                return Err(format!(
                    "Failed while monitoring the Java process: {error}"
                ))
            }
        }

        thread::sleep(Duration::from_millis(BACKEND_STARTUP_POLL_DELAY_MS));
    }

    Ok(())
}

fn terminate_child(child: &mut Child) {
    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) | Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
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

fn set_backend_launch_error<R: tauri::Runtime>(app: &tauri::AppHandle<R>, message: Option<String>) {
    let state = app.state::<BackendLaunchStatus>();
    *state.0.lock().expect("poisoned backend launch state") = message.clone();

    let Ok(backend_base_dir) = resolve_backend_base_dir(app) else {
        return;
    };
    let logs_dir = backend_base_dir.join("logs");
    if fs::create_dir_all(&logs_dir).is_err() {
        return;
    }

    let error_log_path = logs_dir.join(BACKEND_LAUNCH_ERROR_FILE_NAME);
    match message {
        Some(message) => {
            let _ = fs::write(error_log_path, format!("{message}\n"));
        }
        None => {
            let _ = fs::remove_file(error_log_path);
        }
    }
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
        .manage(BackendLaunchStatus::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            match launch_bundled_backend(&app.handle()) {
                Ok(Some(child)) => {
                    set_backend_launch_error(&app.handle(), None);
                    let state = app.state::<ManagedBackendProcess>();
                    *state.0.lock().expect("poisoned backend process state") = Some(child);
                }
                Ok(None) => {
                    set_backend_launch_error(&app.handle(), None);
                }
                Err(error) => {
                    set_backend_launch_error(&app.handle(), Some(error.clone()));
                    eprintln!("MailPilot backend launch skipped: {error}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, get_backend_launch_error])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_bundled_backend(app_handle);
        }
    });
}
