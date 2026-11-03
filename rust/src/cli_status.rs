use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Serialize)]
pub struct CliStatus {
    version: String,
    local: LocalCli,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalCli {
    path: String,
    from_source: bool,
}

/// Read only --version from the same sidecar location used by the desktop Runtime.
/// This never starts an engine session or accesses its home directory.
pub async fn bundled_cli_status(executable: &str) -> Result<CliStatus, String> {
    if executable.is_empty() || !executable.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err("Expected a sidecar executable name".into());
    }
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let file = if cfg!(windows) { format!("{executable}.exe") } else { executable.to_owned() };
    let path = current.parent().ok_or("Executable has no directory")?.join(file);
    read_cli_status(&path, executable).await
}

async fn read_cli_status(path: &Path, executable: &str) -> Result<CliStatus, String> {
    let mut command = tokio::process::Command::new(path);
    command.arg("--version").kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output()).await
        .map_err(|_| "CLI version check timed out".to_owned())?.map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(format!("CLI version check failed: {}", output.status)); }
    let text = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let text = text.trim();
    let version = if executable == "codex" {
        text.strip_prefix("codex-cli ").ok_or("Unexpected Codex version output")?
    } else { text };
    if version.is_empty() { return Err("Empty CLI version output".into()); }
    Ok(CliStatus { version: version.into(), local: LocalCli { path: path.to_string_lossy().into_owned(), from_source: false } })
}

#[tauri::command]
pub async fn cli_status(executable: String) -> Result<CliStatus, String> {
    bundled_cli_status(&executable).await
}
