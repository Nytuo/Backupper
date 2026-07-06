use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, thiserror::Error)]
pub enum ResticError {
    #[error(
        "restic was not found on your PATH. Install it from https://restic.net and try again."
    )]
    NotFound,
    #[error("failed to launch restic: {0}")]
    Spawn(String),
    #[error("{0}")]
    Failed(String),
    #[error("failed to parse restic output: {0}")]
    Parse(String),
}

pub trait ProgressEmitter: Send + Sync {
    fn emit(&self, event_name: &'static str, payload: serde_json::Value);
}

fn to_json(payload: &impl Serialize) -> serde_json::Value {
    serde_json::to_value(payload).unwrap_or(serde_json::Value::Null)
}

fn base_command(repo_path: &str, password: Option<&str>) -> Command {
    let mut cmd = Command::new("restic");
    cmd.arg("-r").arg(repo_path);
    match password {
        Some(password) => {
            cmd.env("RESTIC_PASSWORD", password);
        }
        None => {
            cmd.arg("--insecure-no-password");
        }
    }
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd
}

pub async fn detect_restic() -> Result<String, ResticError> {
    let output = Command::new("restic")
        .arg("version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|_| ResticError::NotFound)?;
    if !output.status.success() {
        return Err(ResticError::NotFound);
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub async fn init_repo(repo_path: &str, password: Option<&str>) -> Result<(), ResticError> {
    let mut cmd = base_command(repo_path, password);
    cmd.arg("init");
    let output = cmd
        .output()
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;
    if !output.status.success() {
        return Err(ResticError::Failed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Snapshot {
    pub id: String,
    pub short_id: String,
    pub time: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

pub async fn list_snapshots(
    repo_path: &str,
    password: Option<&str>,
) -> Result<Vec<Snapshot>, ResticError> {
    let mut cmd = base_command(repo_path, password);
    cmd.arg("snapshots").arg("--json");
    let output = cmd
        .output()
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;
    if !output.status.success() {
        return Err(ResticError::Failed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| ResticError::Parse(e.to_string()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TreeEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub path: String,
    #[serde(default)]
    pub size: u64,
}

pub async fn list_files(
    repo_path: &str,
    password: Option<&str>,
    snapshot_id: &str,
    path: &str,
) -> Result<Vec<TreeEntry>, ResticError> {
    let mut cmd = base_command(repo_path, password);
    cmd.arg("ls").arg(snapshot_id).arg(path).arg("--json");
    let output = cmd
        .output()
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;
    if !output.status.success() {
        return Err(ResticError::Failed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    Ok(parse_ls_output(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_ls_output(text: &str) -> Vec<TreeEntry> {
    let mut entries = Vec::new();
    let mut skipped_self = false;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if value.get("message_type").and_then(|v| v.as_str()) != Some("node") {
            continue;
        }
        if !skipped_self {
            skipped_self = true;
            continue;
        }
        if let Ok(entry) = serde_json::from_value::<TreeEntry>(value) {
            entries.push(entry);
        }
    }
    entries
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ErrorDetail {
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "message_type", rename_all = "snake_case")]
pub enum BackupEvent {
    Status {
        #[serde(default)]
        percent_done: f64,
        #[serde(default)]
        total_files: u64,
        #[serde(default)]
        files_done: u64,
        #[serde(default)]
        total_bytes: u64,
        #[serde(default)]
        bytes_done: u64,
    },
    Summary {
        #[serde(default)]
        files_new: u64,
        #[serde(default)]
        files_changed: u64,
        #[serde(default)]
        files_unmodified: u64,
        #[serde(default)]
        data_added: u64,
        #[serde(default)]
        total_files_processed: u64,
        #[serde(default)]
        total_bytes_processed: u64,
        #[serde(default)]
        snapshot_id: String,
    },
    Error {
        #[serde(default)]
        error: ErrorDetail,
        #[serde(default)]
        during: String,
        #[serde(default)]
        item: String,
    },
    #[serde(other)]
    Unknown,
}

async fn run_json_streaming(
    emitter: Arc<dyn ProgressEmitter>,
    mut cmd: Command,
    event_name: &'static str,
) -> Result<BackupEvent, ResticError> {
    let mut child = cmd.spawn().map_err(|e| ResticError::Spawn(e.to_string()))?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let emitter_for_stdout = emitter.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut summary = None;
        let mut errors = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(evt) = serde_json::from_str::<BackupEvent>(&line) {
                emitter_for_stdout.emit(event_name, to_json(&evt));
                match &evt {
                    BackupEvent::Summary { .. } => summary = Some(evt),
                    BackupEvent::Error { error, .. } => errors.push(error.message.clone()),
                    _ => {}
                }
            }
        }
        (summary, errors)
    });

    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut out = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            out.push(line);
        }
        out
    });

    let (summary, mut errors) = stdout_task
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;
    let stderr_lines = stderr_task
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;
    errors.extend(stderr_lines);

    let status = child
        .wait()
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;

    if !status.success() {
        return Err(ResticError::Failed(if errors.is_empty() {
            "restic exited with an error".to_string()
        } else {
            errors.join("\n")
        }));
    }

    summary.ok_or_else(|| ResticError::Parse("no summary received from restic".to_string()))
}

async fn run_log_streaming(
    emitter: Arc<dyn ProgressEmitter>,
    mut cmd: Command,
    event_name: &'static str,
) -> Result<(), ResticError> {
    let mut child = cmd.spawn().map_err(|e| ResticError::Spawn(e.to_string()))?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let emitter_for_stdout = emitter.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emitter_for_stdout.emit(event_name, serde_json::Value::String(line));
        }
    });

    let emitter_for_stderr = emitter.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut out = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            emitter_for_stderr.emit(event_name, serde_json::Value::String(line.clone()));
            out.push(line);
        }
        out
    });

    stdout_task
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;
    let stderr_lines = stderr_task
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;

    let status = child
        .wait()
        .await
        .map_err(|e| ResticError::Spawn(e.to_string()))?;

    if !status.success() {
        return Err(ResticError::Failed(if stderr_lines.is_empty() {
            "restic exited with an error".to_string()
        } else {
            stderr_lines.join("\n")
        }));
    }
    Ok(())
}

pub async fn backup(
    emitter: Arc<dyn ProgressEmitter>,
    repo_path: &str,
    password: Option<&str>,
    sources: &[String],
) -> Result<BackupEvent, ResticError> {
    let mut cmd = base_command(repo_path, password);
    cmd.arg("backup").arg("--json");
    for source in sources {
        cmd.arg(source);
    }
    run_json_streaming(emitter, cmd, "backup-event").await
}

pub async fn restore(
    emitter: Arc<dyn ProgressEmitter>,
    repo_path: &str,
    password: Option<&str>,
    snapshot_id: &str,
    target_path: &str,
    include: &[String],
) -> Result<(), ResticError> {
    let mut cmd = base_command(repo_path, password);
    cmd.arg("restore")
        .arg(snapshot_id)
        .arg("--target")
        .arg(target_path);
    for path in include {
        cmd.arg("--include").arg(path);
    }
    run_log_streaming(emitter, cmd, "restore-log").await
}

pub async fn replicate(
    emitter: Arc<dyn ProgressEmitter>,
    repo_path: &str,
    password: Option<&str>,
    replica_repo_path: &str,
    replica_password: &str,
) -> Result<(), ResticError> {
    use std::io::Write;

    let mut cmd = base_command(replica_repo_path, Some(replica_password));
    cmd.arg("copy").arg("--from-repo").arg(repo_path);

    let mut _from_password_file = None;
    match password {
        Some(password) => {
            let mut file =
                tempfile::NamedTempFile::new().map_err(|e| ResticError::Spawn(e.to_string()))?;
            file.write_all(password.as_bytes())
                .map_err(|e| ResticError::Spawn(e.to_string()))?;
            cmd.arg("--from-password-file").arg(file.path());
            _from_password_file = Some(file);
        }
        None => {
            cmd.arg("--from-insecure-no-password");
        }
    }

    run_log_streaming(emitter, cmd, "replicate-log").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_status_event() {
        let line = r#"{"message_type":"status","percent_done":0.42,"total_files":10,"files_done":4,"total_bytes":1000,"bytes_done":420}"#;
        let evt: BackupEvent = serde_json::from_str(line).unwrap();
        match evt {
            BackupEvent::Status {
                percent_done,
                total_files,
                files_done,
                ..
            } => {
                assert!((percent_done - 0.42).abs() < f64::EPSILON);
                assert_eq!(total_files, 10);
                assert_eq!(files_done, 4);
            }
            other => panic!("expected Status, got {other:?}"),
        }
    }

    #[test]
    fn parses_summary_event() {
        let line = r#"{"message_type":"summary","files_new":2,"files_changed":0,"files_unmodified":9,"data_added":4992,"total_files_processed":11,"total_bytes_processed":19,"snapshot_id":"776a59f5"}"#;
        let evt: BackupEvent = serde_json::from_str(line).unwrap();
        match evt {
            BackupEvent::Summary {
                snapshot_id,
                files_new,
                ..
            } => {
                assert_eq!(snapshot_id, "776a59f5");
                assert_eq!(files_new, 2);
            }
            other => panic!("expected Summary, got {other:?}"),
        }
    }

    #[test]
    fn parses_error_event() {
        let line = r#"{"message_type":"error","error":{"message":"permission denied"},"during":"backup","item":"/etc/shadow"}"#;
        let evt: BackupEvent = serde_json::from_str(line).unwrap();
        match evt {
            BackupEvent::Error {
                error,
                during,
                item,
            } => {
                assert_eq!(error.message, "permission denied");
                assert_eq!(during, "backup");
                assert_eq!(item, "/etc/shadow");
            }
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn unknown_message_types_do_not_fail_parsing() {
        let line = r#"{"message_type":"verbose_status","action":"unchanged"}"#;
        let evt: BackupEvent = serde_json::from_str(line).unwrap();
        assert!(matches!(evt, BackupEvent::Unknown));
    }

    #[test]
    fn parses_snapshots_list() {
        let json = r#"[{"id":"abc123","short_id":"abc123","time":"2026-01-01T00:00:00Z","hostname":"host","paths":["/home/me"],"tags":[]}]"#;
        let snapshots: Vec<Snapshot> = serde_json::from_str(json).unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].short_id, "abc123");
        assert_eq!(snapshots[0].paths, vec!["/home/me".to_string()]);
    }

    #[test]
    fn parses_snapshots_missing_optional_fields() {
        let json = r#"[{"id":"abc123","short_id":"abc123","time":"2026-01-01T00:00:00Z"}]"#;
        let snapshots: Vec<Snapshot> = serde_json::from_str(json).unwrap();
        assert_eq!(snapshots[0].hostname, "");
        assert!(snapshots[0].paths.is_empty());
    }

    #[test]
    fn parse_ls_output_skips_summary_and_queried_dir() {
        let output = [
            r#"{"message_type":"snapshot","id":"abc123","short_id":"abc123","time":"2026-01-01T00:00:00Z"}"#,
            r#"{"name":"source","type":"dir","path":"/home/me/source","message_type":"node"}"#,
            r#"{"name":"file1.txt","type":"file","path":"/home/me/source/file1.txt","size":42,"message_type":"node"}"#,
            r#"{"name":"sub1","type":"dir","path":"/home/me/source/sub1","message_type":"node"}"#,
        ]
        .join("\n");

        let entries = parse_ls_output(&output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "file1.txt");
        assert_eq!(entries[0].kind, "file");
        assert_eq!(entries[0].size, 42);
        assert_eq!(entries[1].name, "sub1");
        assert_eq!(entries[1].kind, "dir");
    }

    #[test]
    fn parse_ls_output_handles_empty_directory() {
        let output = r#"{"message_type":"snapshot","id":"abc123"}
{"name":"empty","type":"dir","path":"/home/me/empty","message_type":"node"}"#;
        assert!(parse_ls_output(output).is_empty());
    }

    #[test]
    fn parse_ls_output_skips_malformed_lines() {
        let output = "not json at all\n{}\n";
        assert!(parse_ls_output(output).is_empty());
    }
}
