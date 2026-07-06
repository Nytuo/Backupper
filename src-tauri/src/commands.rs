use std::sync::Arc;

use tauri::AppHandle;
use uuid::Uuid;

use crate::config::{self, Replica, Repo};
use crate::errors::AppError;
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
