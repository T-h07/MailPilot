use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::Serialize;
use tauri::{Manager, RunEvent};

const BACKEND_SOCKET_ADDR: &str = "127.0.0.1:8082";
const BACKEND_JAR_RELATIVE_PATH: &str = "backend/mailpilot-server.jar";
const BACKEND_LOG_FILE_NAME: &str = "backend.out.log";
const BACKEND_ERROR_LOG_FILE_NAME: &str = "backend.err.log";
const BACKEND_LAUNCHER_LOG_FILE_NAME: &str = "backend-launcher.log";
const BACKEND_LAUNCH_ERROR_FILE_NAME: &str = "backend-launch-error.log";
const BACKEND_HEALTH_REQUEST: &str =
    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
const BACKEND_STARTUP_POLL_ATTEMPTS: usize = 120;
const BACKEND_STARTUP_POLL_DELAY_MS: u64 = 500;
const MINIMUM_JAVA_MAJOR_VERSION: u32 = 21;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct ManagedBackendProcess(Mutex<Option<Child>>);

#[derive(Default)]
struct BackendLaunchStatus(Mutex<Option<String>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStartupStatus {
    phase: String,
    detail: Option<String>,
    attempt: usize,
    max_attempts: usize,
}

impl Default for BackendStartupStatus {
    fn default() -> Self {
        Self {
            phase: "idle".to_string(),
            detail: None,
            attempt: 0,
            max_attempts: BACKEND_STARTUP_POLL_ATTEMPTS,
        }
    }
}

#[derive(Default)]
struct BackendStartupStatusState(Mutex<BackendStartupStatus>);

enum BackendHealthStatus {
    Healthy,
    NotReady,
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

#[tauri::command]
fn get_backend_startup_status(
    state: tauri::State<'_, BackendStartupStatusState>,
) -> BackendStartupStatus {
    state
        .0
        .lock()
        .expect("poisoned backend startup state")
        .clone()
}

#[tauri::command]
fn get_backend_logs_dir(app: tauri::AppHandle) -> Option<String> {
    resolve_backend_base_dir(&app)
        .ok()
        .map(|base_dir| base_dir.join("logs").display().to_string())
}

#[tauri::command]
fn mark_backend_ui_ready(app: tauri::AppHandle) {
    let Ok(base_dir) = resolve_backend_base_dir(&app) else {
        return;
    };
    let logs_dir = base_dir.join("logs");
    let _ = fs::create_dir_all(&logs_dir);
    append_launcher_log(
        &logs_dir,
        "Loading screen dismissed after backend readiness confirmed.",
    );
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
        return BackendHealthStatus::NotReady;
    }

    let mut response = Vec::new();
    if stream.read_to_end(&mut response).is_err() {
        return BackendHealthStatus::NotReady;
    }

    let response = String::from_utf8_lossy(&response);
    let is_http_ok = response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200");
    let has_ready_marker = response.contains("\"status\":\"ok\"")
        || response.contains("\"status\":\"UP\"")
        || response.contains("\"app\":\"MailPilot\"");
    if is_http_ok && has_ready_marker
    {
        return BackendHealthStatus::Healthy;
    }

    BackendHealthStatus::NotReady
}

fn launch_bundled_backend<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Option<Child>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }

    let backend_base_dir = resolve_backend_base_dir(app)?;
    let logs_dir = backend_base_dir.join("logs");
    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("Failed to create backend log directory: {error}"))?;
    append_launcher_log(
        &logs_dir,
        &format!(
            "Launcher mode=packaged socket={} baseDir={}",
            BACKEND_SOCKET_ADDR,
            backend_base_dir.display()
        ),
    );
    update_backend_startup_status(
        app,
        "launching",
        Some("Starting MailPilot backend...".to_string()),
        0,
    );

    match backend_health_status() {
        BackendHealthStatus::Healthy => {
            append_launcher_log(
                &logs_dir,
                "Detected an already healthy backend instance; reusing it.",
            );
            update_backend_startup_status(
                app,
                "ready",
                Some("Using existing healthy backend.".to_string()),
                0,
            );
            return Ok(None);
        }
        BackendHealthStatus::NotReady | BackendHealthStatus::Unreachable => {}
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to resolve resource directory: {error}"))?;
    let backend_jar_path = normalize_path_for_process(resource_dir.join(BACKEND_JAR_RELATIVE_PATH));
    if !backend_jar_path.exists() {
        return Err(format!(
            "Bundled backend JAR not found at {}",
            backend_jar_path.display()
        ));
    }
    append_launcher_log(
        &logs_dir,
        &format!(
            "Resolved backend jar={} workingDir={}",
            backend_jar_path.display(),
            backend_base_dir.display()
        ),
    );

    let mut last_error = None;
    for java_binary in java_binary_candidates(&resource_dir) {
        append_launcher_log(
            &logs_dir,
            &format!("Inspecting Java candidate: {}", java_binary.display()),
        );
        match java_binary_meets_minimum_version(&java_binary) {
            Ok(true) => {}
            Ok(false) => {
                append_launcher_log(
                    &logs_dir,
                    &format!(
                        "Java candidate rejected for version check: {}",
                        java_binary.display()
                    ),
                );
                last_error = Some(format!(
                    "MailPilot requires Java {MINIMUM_JAVA_MAJOR_VERSION}+ but found an older runtime at {}.",
                    java_binary.display()
                ));
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                append_launcher_log(
                    &logs_dir,
                    &format!("Java candidate not found: {}", java_binary.display()),
                );
                continue;
            }
            Err(error) => {
                append_launcher_log(
                    &logs_dir,
                    &format!(
                        "Java candidate inspection failed at {}: {}",
                        java_binary.display(),
                        error
                    ),
                );
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
            Ok(mut child) => {
                append_launcher_log(
                    &logs_dir,
                    &format!(
                        "Backend process launched with pid={} java={}",
                        child.id(),
                        java_binary.display()
                    ),
                );
                match wait_for_backend_start(app, &mut child, &logs_dir) {
                Ok(()) => return Ok(Some(child)),
                Err(error) => {
                    terminate_child(&mut child);
                    append_launcher_log(
                        &logs_dir,
                        &format!(
                            "Backend startup failed for java={} with error={}",
                            java_binary.display(),
                            error
                        ),
                    );
                    last_error = Some(format!(
                        "Failed to launch MailPilot's bundled backend with {}: {error}",
                        java_binary.display()
                    ));
                }
            }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                append_launcher_log(
                    &logs_dir,
                    &format!(
                        "Spawn failed for java={} error={}",
                        java_binary.display(),
                        error
                    ),
                );
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

fn normalize_path_for_process(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let raw = path.to_string_lossy();
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }

    path
}

fn update_backend_startup_status<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    phase: &str,
    detail: Option<String>,
    attempt: usize,
) {
    let state = app.state::<BackendStartupStatusState>();
    *state.0.lock().expect("poisoned backend startup state") = BackendStartupStatus {
        phase: phase.to_string(),
        detail,
        attempt,
        max_attempts: BACKEND_STARTUP_POLL_ATTEMPTS,
    };
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

fn wait_for_backend_start<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    child: &mut Child,
    logs_dir: &Path,
) -> Result<(), String> {
    for attempt in 1..=BACKEND_STARTUP_POLL_ATTEMPTS {
        append_launcher_log(
            logs_dir,
            &format!(
                "Waiting for backend health endpoint attempt {}/{}",
                attempt, BACKEND_STARTUP_POLL_ATTEMPTS
            ),
        );
        update_backend_startup_status(
            app,
            "waiting",
            Some("Still starting database...".to_string()),
            attempt,
        );

        match backend_health_status() {
            BackendHealthStatus::Healthy => {
                append_launcher_log(logs_dir, "Backend health success received.");
                update_backend_startup_status(
                    app,
                    "ready",
                    Some("Backend health confirmed.".to_string()),
                    attempt,
                );
                return Ok(());
            }
            BackendHealthStatus::NotReady | BackendHealthStatus::Unreachable => {}
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                append_launcher_log(
                    logs_dir,
                    &format!("Backend exited early with status {status}."),
                );
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

    append_launcher_log(
        logs_dir,
        "Backend startup timed out before health check succeeded.",
    );
    Err(format!(
        "The backend process did not report healthy status on {} within {} seconds. Check %LOCALAPPDATA%\\MailPilot\\logs\\backend.err.log.",
        BACKEND_SOCKET_ADDR,
        (BACKEND_STARTUP_POLL_ATTEMPTS as u64 * BACKEND_STARTUP_POLL_DELAY_MS) / 1000
    ))
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

fn append_launcher_log(logs_dir: &Path, message: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let log_line = format!("[{timestamp}] {message}\n");
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_dir.join(BACKEND_LAUNCHER_LOG_FILE_NAME))
    {
        let _ = file.write_all(log_line.as_bytes());
    }
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
        .manage(BackendStartupStatusState::default())
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
                    update_backend_startup_status(
                        &app.handle(),
                        "failed",
                        Some(error.clone()),
                        0,
                    );
                    eprintln!("MailPilot backend launch skipped: {error}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_backend_launch_error,
            get_backend_startup_status,
            get_backend_logs_dir,
            mark_backend_ui_ready
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_bundled_backend(app_handle);
        }
    });
}
