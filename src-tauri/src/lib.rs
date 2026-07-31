use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};

use tauri::Manager;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

mod mcp_bridge;
use mcp_bridge::McpState;

#[tauri::command]
fn export_document_package(
    document_path: String,
    content: String,
    destination_path: String,
) -> Result<(), String> {
    let document = Path::new(&document_path);
    let document_name = document
        .file_name()
        .ok_or_else(|| "无法取得文档文件名。".to_string())?
        .to_string_lossy()
        .to_string();
    let parent = document
        .parent()
        .ok_or_else(|| "无法取得文档所在目录。".to_string())?;
    let output = File::create(destination_path).map_err(|error| error.to_string())?;
    let mut archive = ZipWriter::new(output);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    archive
        .start_file(document_name, options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;

    let assets = parent.join("assets");
    if assets.is_dir() {
        for entry in WalkDir::new(&assets).into_iter().filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }

            let relative_path = entry
                .path()
                .strip_prefix(parent)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            archive
                .start_file(relative_path, options)
                .map_err(|error| error.to_string())?;
            let mut source = File::open(entry.path()).map_err(|error| error.to_string())?;
            let mut bytes = Vec::new();
            source
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            archive
                .write_all(&bytes)
                .map_err(|error| error.to_string())?;
        }
    }

    archive.finish().map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RunBashResult {
    command: String,
    cwd: String,
    shell: String,
    exit_code: i32,
    stdout: String,
    stderr: String,
    duration_ms: u64,
    timed_out: bool,
}

/// 在 Windows 上查找 Git Bash 可执行文件路径。
/// 依次检查常见安装位置；未找到则返回 None（调用方回退到 PATH 中的 bash）。
#[cfg(windows)]
fn find_git_bash() -> Option<String> {
    use std::path::Path;

    // 系统级安装（64 位 / 32 位 Program Files）。
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
    ];
    for path in &candidates {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // 用户级安装（%LOCALAPPDATA%\Programs\Git）。
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let user_path = Path::new(&local_app_data)
            .join("Programs")
            .join("Git")
            .join("bin")
            .join("bash.exe");
        if user_path.exists() {
            return Some(user_path.to_string_lossy().into_owned());
        }
    }
    None
}

/// 执行 shell 命令。shell 可选：cmd/powershell/gitbash/sh/bash/zsh。
/// Windows 默认 powershell、macOS 默认 zsh、其它 Unix 默认 bash。
#[tauri::command]
async fn run_bash(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    shell: Option<String>,
) -> Result<RunBashResult, String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    use tokio::process::Command;

    let started = Instant::now();
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(60_000));
    let shell_name = shell.as_deref().unwrap_or("").to_lowercase();

    // Windows 下查找 Git Bash 可执行文件路径（仅 shell=gitbash 时使用）。
    #[cfg(windows)]
    let git_bash_path: Option<String> = if shell_name == "gitbash" {
        find_git_bash()
    } else {
        None
    };

    #[cfg(windows)]
    let (program, args, shell_label) = match shell_name.as_str() {
        "cmd" => ("cmd", vec!["/C", &command], "cmd"),
        "gitbash" => (
            // 优先使用探测到的 Git Bash 路径；未找到则回退到 PATH 中的 bash。
            git_bash_path.as_deref().unwrap_or("bash"),
            vec!["-c", &command],
            "gitbash",
        ),
        _ => (
            "powershell",
            vec!["-NoProfile", "-Command", &command],
            "powershell",
        ),
    };
    #[cfg(target_os = "macos")]
    let (program, args, shell_label) = match shell_name.as_str() {
        "bash" => ("bash", vec!["-c", &command], "bash"),
        "sh" => ("sh", vec!["-c", &command], "sh"),
        _ => ("zsh", vec!["-c", &command], "zsh"),
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, args, shell_label) = match shell_name.as_str() {
        "sh" => ("sh", vec!["-c", &command], "sh"),
        "zsh" => ("zsh", vec!["-c", &command], "zsh"),
        _ => ("bash", vec!["-c", &command], "bash"),
    };

    let mut cmd = Command::new(program);
    cmd.args(&args);
    if let Some(dir) = cwd.as_deref().filter(|s| !s.is_empty()) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 {shell_label}：{e}"))?;
    let outcome = tokio::time::timeout(timeout, child.wait_with_output()).await;
    let duration_ms = started.elapsed().as_millis() as u64;

    match outcome {
        Ok(Ok(output)) => Ok(RunBashResult {
            command,
            cwd: cwd.unwrap_or_default(),
            shell: shell_label.to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            duration_ms,
            timed_out: false,
        }),
        Ok(Err(e)) => Err(format!("命令执行失败：{e}")),
        Err(_) => Ok(RunBashResult {
            command,
            cwd: cwd.unwrap_or_default(),
            shell: shell_label.to_string(),
            exit_code: -1,
            stdout: String::new(),
            stderr: format!("命令执行超时（{} ms）", timeout.as_millis()),
            duration_ms,
            timed_out: true,
        }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // persisted-scope 必须在 fs 之后，才能跨重启恢复对话框授予的目录权限。
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(McpState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            export_document_package,
            run_bash,
            mcp_bridge::mcp_connect,
            mcp_bridge::mcp_disconnect,
            mcp_bridge::mcp_list_all_tools,
            mcp_bridge::mcp_call_tool,
            mcp_bridge::mcp_health_check,
            mcp_bridge::mcp_shutdown_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
