use std::sync::Arc;

use tauri::AppHandle;
use uuid::Uuid;

use crate::config::{self, GitTarget, Replica, Repo};
use crate::errors::AppError;
use crate::git_backup::{self, GitProvider, LocalMirror, RemoteRepo};
use crate::restic::{self, BackupEvent, ProgressEmitter, Snapshot, TreeEntry};
use crate::AppHandleEmitter;

fn now_unix_secs() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    now.as_secs().to_string()
}

fn emitter_for(app: &AppHandle) -> Arc<dyn ProgressEmitter> {
    Arc::new(AppHandleEmitter(app.clone()))
}

#[tauri::command]
pub async fn detect_restic() -> Result<String, AppError> {
    Ok(restic::detect_restic().await?)
}

#[tauri::command]
pub fn list_repos(app: AppHandle) -> Result<Vec<Repo>, AppError> {
    Ok(config::load_repos(&app)?)
}

#[tauri::command]
pub async fn create_repo(
    app: AppHandle,
    label: String,
    source_paths: Vec<String>,
    repo_path: String,
    password: Option<String>,
) -> Result<Repo, AppError> {
    restic::init_repo(&repo_path, password.as_deref()).await?;

    let id = Uuid::new_v4().to_string();
    let encrypted = password.is_some();
    if let Some(ref password) = password {
        config::set_password(&id, password)?;
    }

    let repo = Repo {
        id,
        label,
        repo_path,
        source_paths,
        replicas: Vec::new(),
        created_at: now_unix_secs(),
        encrypted,
    };

    let mut repos = config::load_repos(&app)?;
    repos.push(repo.clone());
    config::save_repos(&app, &repos)?;

    Ok(repo)
}

#[tauri::command]
pub fn update_repo(
    app: AppHandle,
    repo_id: String,
    label: String,
    source_paths: Vec<String>,
) -> Result<Repo, AppError> {
    let mut repos = config::load_repos(&app)?;
    let repo = repos
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or(AppError::RepoNotFound)?;

    repo.label = label;
    repo.source_paths = source_paths;
    let updated = repo.clone();

    config::save_repos(&app, &repos)?;
    Ok(updated)
}

#[tauri::command]
pub fn remove_repo(app: AppHandle, repo_id: String) -> Result<(), AppError> {
    let mut repos = config::load_repos(&app)?;
    let idx = repos
        .iter()
        .position(|r| r.id == repo_id)
        .ok_or(AppError::RepoNotFound)?;
    let repo = repos.remove(idx);

    if repo.encrypted {
        config::delete_password(&repo.id);
    }
    for replica in &repo.replicas {
        config::delete_password(&config::replica_keyring_account(&repo.id, &replica.id));
    }

    config::save_repos(&app, &repos)?;
    Ok(())
}

fn find_repo(repos: &[Repo], repo_id: &str) -> Result<Repo, AppError> {
    repos
        .iter()
        .find(|r| r.id == repo_id)
        .cloned()
        .ok_or(AppError::RepoNotFound)
}

fn repo_password(repo: &Repo) -> Result<Option<String>, AppError> {
    if repo.encrypted {
        Ok(Some(config::get_password(&repo.id)?))
    } else {
        Ok(None)
    }
}

fn latest_snapshot_paths(snapshots: &[Snapshot]) -> Vec<String> {
    snapshots
        .iter()
        .max_by(|a, b| a.time.cmp(&b.time))
        .map(|s| s.paths.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn check_path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
pub async fn import_restic_repo(
    app: AppHandle,
    label: String,
    repo_path: String,
    password: Option<String>,
) -> Result<Repo, AppError> {
    let snapshots = restic::list_snapshots(&repo_path, password.as_deref()).await?;
    let source_paths = latest_snapshot_paths(&snapshots);

    let id = Uuid::new_v4().to_string();
    let encrypted = password.is_some();
    if let Some(ref password) = password {
        config::set_password(&id, password)?;
    }

    let repo = Repo {
        id,
        label,
        repo_path,
        source_paths,
        replicas: Vec::new(),
        created_at: now_unix_secs(),
        encrypted,
    };

    let mut repos = config::load_repos(&app)?;
    repos.push(repo.clone());
    config::save_repos(&app, &repos)?;

    Ok(repo)
}

#[tauri::command]
pub async fn relink_repo(
    app: AppHandle,
    repo_id: String,
    new_repo_path: String,
) -> Result<Repo, AppError> {
    let mut repos = config::load_repos(&app)?;
    let idx = repos
        .iter()
        .position(|r| r.id == repo_id)
        .ok_or(AppError::RepoNotFound)?;
    let password = repo_password(&repos[idx])?;

    restic::list_snapshots(&new_repo_path, password.as_deref()).await?;

    repos[idx].repo_path = new_repo_path;
    let updated = repos[idx].clone();
    config::save_repos(&app, &repos)?;
    Ok(updated)
}

#[tauri::command]
pub async fn run_backup(app: AppHandle, repo_id: String) -> Result<BackupEvent, AppError> {
    let repos = config::load_repos(&app)?;
    let repo = find_repo(&repos, &repo_id)?;
    let password = repo_password(&repo)?;

    Ok(restic::backup(
        emitter_for(&app),
        &repo.repo_path,
        password.as_deref(),
        &repo.source_paths,
    )
    .await?)
}

#[tauri::command]
pub async fn list_snapshots(app: AppHandle, repo_id: String) -> Result<Vec<Snapshot>, AppError> {
    let repos = config::load_repos(&app)?;
    let repo = find_repo(&repos, &repo_id)?;
    let password = repo_password(&repo)?;

    Ok(restic::list_snapshots(&repo.repo_path, password.as_deref()).await?)
}

#[tauri::command]
pub async fn list_snapshot_files(
    app: AppHandle,
    repo_id: String,
    snapshot_id: String,
    path: String,
) -> Result<Vec<TreeEntry>, AppError> {
    let repos = config::load_repos(&app)?;
    let repo = find_repo(&repos, &repo_id)?;
    let password = repo_password(&repo)?;

    Ok(restic::list_files(&repo.repo_path, password.as_deref(), &snapshot_id, &path).await?)
}

#[tauri::command]
pub async fn restore_snapshot(
    app: AppHandle,
    repo_id: String,
    snapshot_id: String,
    target_path: String,
    include: Vec<String>,
) -> Result<(), AppError> {
    let repos = config::load_repos(&app)?;
    let repo = find_repo(&repos, &repo_id)?;
    let password = repo_password(&repo)?;

    Ok(restic::restore(
        emitter_for(&app),
        &repo.repo_path,
        password.as_deref(),
        &snapshot_id,
        &target_path,
        &include,
    )
    .await?)
}

#[tauri::command]
pub async fn add_replica(
    app: AppHandle,
    repo_id: String,
    label: String,
    repo_path: String,
    password: String,
) -> Result<Replica, AppError> {
    restic::init_repo(&repo_path, Some(&password)).await?;

    let mut repos = config::load_repos(&app)?;
    let repo = repos
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or(AppError::RepoNotFound)?;

    let replica = Replica {
        id: Uuid::new_v4().to_string(),
        label,
        repo_path,
    };

    config::set_password(
        &config::replica_keyring_account(&repo_id, &replica.id),
        &password,
    )?;

    repo.replicas.push(replica.clone());
    config::save_repos(&app, &repos)?;

    Ok(replica)
}

#[tauri::command]
pub async fn run_replicate(
    app: AppHandle,
    repo_id: String,
    replica_id: String,
) -> Result<(), AppError> {
    let repos = config::load_repos(&app)?;
    let repo = find_repo(&repos, &repo_id)?;
    let replica = repo
        .replicas
        .iter()
        .find(|r| r.id == replica_id)
        .cloned()
        .ok_or(AppError::ReplicaNotFound)?;

    let password = repo_password(&repo)?;
    let replica_password =
        config::get_password(&config::replica_keyring_account(&repo_id, &replica_id))?;

    Ok(restic::replicate(
        emitter_for(&app),
        &repo.repo_path,
        password.as_deref(),
        &replica.repo_path,
        &replica_password,
    )
    .await?)
}

fn parse_provider(provider: &str) -> Result<GitProvider, AppError> {
    GitProvider::from_str(provider).ok_or_else(|| AppError::Git {
        message: format!("unknown git provider: {provider}"),
    })
}

fn find_git_target(targets: &[GitTarget], target_id: &str) -> Result<GitTarget, AppError> {
    targets
        .iter()
        .find(|t| t.id == target_id)
        .cloned()
        .ok_or(AppError::GitTargetNotFound)
}

#[tauri::command]
pub async fn detect_git() -> Result<String, AppError> {
    Ok(git_backup::detect_git().await?)
}

#[tauri::command]
pub async fn install_git(app: AppHandle) -> Result<(), AppError> {
    Ok(git_backup::install_git(emitter_for(&app)).await?)
}

#[tauri::command]
pub async fn fetch_remote_repos(
    provider: String,
    server_url: String,
    username: String,
    token: String,
) -> Result<Vec<RemoteRepo>, AppError> {
    let provider = parse_provider(&provider)?;
    Ok(git_backup::fetch_remote_repos(provider, &server_url, &username, &token).await?)
}

#[tauri::command]
pub fn list_git_targets(app: AppHandle) -> Result<Vec<GitTarget>, AppError> {
    Ok(config::load_git_targets(&app)?)
}

#[tauri::command]
pub fn create_git_target(
    app: AppHandle,
    label: String,
    provider: String,
    server_url: String,
    username: String,
    token: String,
    dest_path: String,
    selected_repos: Vec<String>,
) -> Result<GitTarget, AppError> {
    parse_provider(&provider)?;

    let id = Uuid::new_v4().to_string();
    config::set_password(&config::git_target_keyring_account(&id), &token)?;

    let target = GitTarget {
        id,
        label,
        provider,
        server_url,
        username,
        dest_path,
        selected_repos,
        created_at: now_unix_secs(),
    };

    let mut targets = config::load_git_targets(&app)?;
    targets.push(target.clone());
    config::save_git_targets(&app, &targets)?;

    Ok(target)
}

#[tauri::command]
pub fn update_git_target(
    app: AppHandle,
    target_id: String,
    label: String,
    selected_repos: Vec<String>,
) -> Result<GitTarget, AppError> {
    let mut targets = config::load_git_targets(&app)?;
    let target = targets
        .iter_mut()
        .find(|t| t.id == target_id)
        .ok_or(AppError::GitTargetNotFound)?;

    target.label = label;
    target.selected_repos = selected_repos;
    let updated = target.clone();

    config::save_git_targets(&app, &targets)?;
    Ok(updated)
}

#[tauri::command]
pub fn remove_git_target(app: AppHandle, target_id: String) -> Result<(), AppError> {
    let mut targets = config::load_git_targets(&app)?;
    let idx = targets
        .iter()
        .position(|t| t.id == target_id)
        .ok_or(AppError::GitTargetNotFound)?;
    targets.remove(idx);

    config::delete_password(&config::git_target_keyring_account(&target_id));

    config::save_git_targets(&app, &targets)?;
    Ok(())
}

#[tauri::command]
pub fn relink_git_target(
    app: AppHandle,
    target_id: String,
    new_dest_path: String,
) -> Result<GitTarget, AppError> {
    if !std::path::Path::new(&new_dest_path).is_dir() {
        return Err(AppError::Git {
            message: "the chosen folder does not exist".to_string(),
        });
    }

    let mut targets = config::load_git_targets(&app)?;
    let target = targets
        .iter_mut()
        .find(|t| t.id == target_id)
        .ok_or(AppError::GitTargetNotFound)?;

    target.dest_path = new_dest_path;
    let updated = target.clone();

    config::save_git_targets(&app, &targets)?;
    Ok(updated)
}

#[derive(serde::Serialize)]
pub struct GitBackupSummary {
    pub repos_total: usize,
    pub repos_succeeded: usize,
    pub failures: Vec<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum GitBackupProgressStatus {
    Running,
    Success,
    Failed,
}

#[derive(serde::Serialize, Clone)]
pub struct GitBackupProgress {
    pub current: usize,
    pub total: usize,
    pub full_name: String,
    pub status: GitBackupProgressStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[tauri::command]
pub async fn run_git_backup(
    app: AppHandle,
    target_id: String,
) -> Result<GitBackupSummary, AppError> {
    let targets = config::load_git_targets(&app)?;
    let target = find_git_target(&targets, &target_id)?;
    let provider = parse_provider(&target.provider)?;
    let token = config::get_password(&config::git_target_keyring_account(&target_id))?;

    let remote_repos =
        git_backup::fetch_remote_repos(provider, &target.server_url, &target.username, &token)
            .await?;

    let repos_to_backup: Vec<RemoteRepo> = if target.selected_repos.is_empty() {
        remote_repos
    } else {
        remote_repos
            .into_iter()
            .filter(|r| target.selected_repos.contains(&r.full_name))
            .collect()
    };

    let emitter = emitter_for(&app);
    let total = repos_to_backup.len();
    let mut succeeded = 0usize;
    let mut failures = Vec::new();

    for (index, repo) in repos_to_backup.iter().enumerate() {
        let current = index + 1;
        emitter.emit(
            "git-backup-progress",
            serde_json::to_value(GitBackupProgress {
                current,
                total,
                full_name: repo.full_name.clone(),
                status: GitBackupProgressStatus::Running,
                message: None,
            })
            .unwrap_or_default(),
        );

        let result = git_backup::mirror_repo(
            emitter.clone(),
            &target.dest_path,
            provider,
            repo,
            &target.username,
            &token,
        )
        .await;

        match result {
            Ok(()) => {
                succeeded += 1;
                emitter.emit(
                    "git-backup-progress",
                    serde_json::to_value(GitBackupProgress {
                        current,
                        total,
                        full_name: repo.full_name.clone(),
                        status: GitBackupProgressStatus::Success,
                        message: None,
                    })
                    .unwrap_or_default(),
                );
            }
            Err(e) => {
                let message = e.to_string();
                failures.push(format!("{}: {message}", repo.full_name));
                emitter.emit(
                    "git-backup-progress",
                    serde_json::to_value(GitBackupProgress {
                        current,
                        total,
                        full_name: repo.full_name.clone(),
                        status: GitBackupProgressStatus::Failed,
                        message: Some(message),
                    })
                    .unwrap_or_default(),
                );
            }
        }
    }

    Ok(GitBackupSummary {
        repos_total: repos_to_backup.len(),
        repos_succeeded: succeeded,
        failures,
    })
}

#[tauri::command]
pub fn list_local_git_repos(app: AppHandle, target_id: String) -> Result<Vec<LocalMirror>, AppError> {
    let targets = config::load_git_targets(&app)?;
    let target = find_git_target(&targets, &target_id)?;
    Ok(git_backup::list_local_mirrors(&target.dest_path))
}

#[tauri::command]
pub async fn restore_git_repo(
    app: AppHandle,
    target_id: String,
    bare_path: String,
    target_path: String,
) -> Result<(), AppError> {
    let targets = config::load_git_targets(&app)?;
    find_git_target(&targets, &target_id)?;

    Ok(git_backup::restore_mirror(emitter_for(&app), &bare_path, &target_path).await?)
}
