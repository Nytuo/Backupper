use std::sync::{Arc, Mutex};

use backupper_lib::errors::AppError;
use backupper_lib::restic::{self, BackupEvent, ProgressEmitter};

#[derive(Default)]
struct RecordingEmitter {
    events: Mutex<Vec<(String, serde_json::Value)>>,
}

impl ProgressEmitter for RecordingEmitter {
    fn emit(&self, event_name: &'static str, payload: serde_json::Value) {
        self.events
            .lock()
            .unwrap()
            .push((event_name.to_string(), payload));
    }
}

async fn restic_available() -> bool {
    restic::detect_restic().await.is_ok()
}

macro_rules! require_restic {
    () => {
        if !restic_available().await {
            eprintln!("skipping: restic not found on PATH");
            return;
        }
    };
}

#[tokio::test]
async fn full_backup_restore_replicate_cycle() {
    require_restic!();

    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    let repo = root.path().join("repo");
    let restore_target = root.path().join("restore");
    let replica = root.path().join("replica");

    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(source.join("file1.txt"), b"hello world").unwrap();
    std::fs::create_dir_all(source.join("sub")).unwrap();
    std::fs::write(source.join("sub/file2.txt"), b"nested").unwrap();

    let password = "test-password-123";
    let replica_password = "replica-password-456";

    restic::init_repo(repo.to_str().unwrap(), Some(password))
        .await
        .expect("init primary repo");

    let emitter: Arc<dyn ProgressEmitter> = Arc::new(RecordingEmitter::default());
    let summary = restic::backup(
        emitter.clone(),
        repo.to_str().unwrap(),
        Some(password),
        &[source.to_str().unwrap().to_string()],
    )
    .await
    .expect("backup should succeed");

    let snapshot_id = match summary {
        BackupEvent::Summary {
            snapshot_id,
            files_new,
            ..
        } => {
            assert_eq!(files_new, 2);
            snapshot_id
        }
        other => panic!("expected a Summary event, got {other:?}"),
    };
    assert!(!snapshot_id.is_empty());

    let snapshots = restic::list_snapshots(repo.to_str().unwrap(), Some(password))
        .await
        .expect("list snapshots");
    assert_eq!(snapshots.len(), 1);

    restic::restore(
        emitter.clone(),
        repo.to_str().unwrap(),
        Some(password),
        &snapshots[0].id,
        restore_target.to_str().unwrap(),
        &[],
    )
    .await
    .expect("restore should succeed");

    let restored_file1 = walk_for_file(&restore_target, "file1.txt");
    assert!(
        restored_file1.is_some(),
        "restored tree should contain file1.txt"
    );
    assert_eq!(
        std::fs::read_to_string(restored_file1.unwrap()).unwrap(),
        "hello world"
    );

    restic::init_repo(replica.to_str().unwrap(), Some(replica_password))
        .await
        .expect("init replica repo");

    restic::replicate(
        emitter,
        repo.to_str().unwrap(),
        Some(password),
        replica.to_str().unwrap(),
        replica_password,
    )
    .await
    .expect("replicate should succeed");

    let replica_snapshots =
        restic::list_snapshots(replica.to_str().unwrap(), Some(replica_password))
            .await
            .expect("list replica snapshots");
    assert_eq!(replica_snapshots.len(), 1);
}

#[tokio::test]
async fn unencrypted_repo_backup_and_restore_cycle() {
    require_restic!();

    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    let repo = root.path().join("repo");
    let restore_target = root.path().join("restore");

    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(source.join("file1.txt"), b"no password here").unwrap();

    restic::init_repo(repo.to_str().unwrap(), None)
        .await
        .expect("init unencrypted repo");

    let emitter: Arc<dyn ProgressEmitter> = Arc::new(RecordingEmitter::default());
    let summary = restic::backup(
        emitter.clone(),
        repo.to_str().unwrap(),
        None,
        &[source.to_str().unwrap().to_string()],
    )
    .await
    .expect("backup on an unencrypted repo should succeed");

    assert!(matches!(summary, BackupEvent::Summary { .. }));

    let snapshots = restic::list_snapshots(repo.to_str().unwrap(), None)
        .await
        .expect("list snapshots on an unencrypted repo");
    assert_eq!(snapshots.len(), 1);

    restic::restore(
        emitter,
        repo.to_str().unwrap(),
        None,
        &snapshots[0].id,
        restore_target.to_str().unwrap(),
        &[],
    )
    .await
    .expect("restore from an unencrypted repo should succeed");

    assert!(walk_for_file(&restore_target, "file1.txt").is_some());
}

#[tokio::test]
async fn replicate_from_unencrypted_repo_to_encrypted_replica() {
    require_restic!();

    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    let repo = root.path().join("repo");
    let replica = root.path().join("replica");

    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(source.join("file1.txt"), b"still no password").unwrap();

    restic::init_repo(repo.to_str().unwrap(), None)
        .await
        .expect("init unencrypted primary repo");

    let emitter: Arc<dyn ProgressEmitter> = Arc::new(RecordingEmitter::default());
    restic::backup(
        emitter.clone(),
        repo.to_str().unwrap(),
        None,
        &[source.to_str().unwrap().to_string()],
    )
    .await
    .expect("backup should succeed");

    let replica_password = "replica-password-789";
    restic::init_repo(replica.to_str().unwrap(), Some(replica_password))
        .await
        .expect("init replica repo");

    restic::replicate(
        emitter,
        repo.to_str().unwrap(),
        None,
        replica.to_str().unwrap(),
        replica_password,
    )
    .await
    .expect("replicate from an unencrypted source should succeed");

    let replica_snapshots =
        restic::list_snapshots(replica.to_str().unwrap(), Some(replica_password))
            .await
            .expect("list replica snapshots");
    assert_eq!(replica_snapshots.len(), 1);
}

#[tokio::test]
async fn browse_and_restore_specific_files_from_a_snapshot() {
    require_restic!();

    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    let repo = root.path().join("repo");
    let restore_target = root.path().join("restore");

    std::fs::create_dir_all(source.join("Documents")).unwrap();
    std::fs::create_dir_all(source.join("Photos")).unwrap();
    std::fs::write(source.join("Documents/report.txt"), b"report contents").unwrap();
    std::fs::write(source.join("Photos/beach.jpg"), b"jpeg bytes").unwrap();

    let password = "browse-password-123";
    restic::init_repo(repo.to_str().unwrap(), Some(password))
        .await
        .expect("init repo");

    let emitter: Arc<dyn ProgressEmitter> = Arc::new(RecordingEmitter::default());
    restic::backup(
        emitter.clone(),
        repo.to_str().unwrap(),
        Some(password),
        &[source.to_str().unwrap().to_string()],
    )
    .await
    .expect("backup should succeed");

    let snapshots = restic::list_snapshots(repo.to_str().unwrap(), Some(password))
        .await
        .expect("list snapshots");
    let snapshot_id = &snapshots[0].id;

    let root_entries = restic::list_files(
        repo.to_str().unwrap(),
        Some(password),
        snapshot_id,
        source.to_str().unwrap(),
    )
    .await
    .expect("list files at snapshot root");
    let root_names: Vec<&str> = root_entries.iter().map(|e| e.name.as_str()).collect();
    assert!(root_names.contains(&"Documents"));
    assert!(root_names.contains(&"Photos"));
    assert!(
        !root_names.contains(&"report.txt"),
        "non-recursive listing should not reach into subfolders"
    );

    let documents_path = source.join("Documents");
    let documents_entries = restic::list_files(
        repo.to_str().unwrap(),
        Some(password),
        snapshot_id,
        documents_path.to_str().unwrap(),
    )
    .await
    .expect("list files inside Documents");
    assert_eq!(documents_entries.len(), 1);
    assert_eq!(documents_entries[0].name, "report.txt");
    assert_eq!(documents_entries[0].kind, "file");

    restic::restore(
        emitter,
        repo.to_str().unwrap(),
        Some(password),
        snapshot_id,
        restore_target.to_str().unwrap(),
        &[documents_entries[0].path.clone()],
    )
    .await
    .expect("partial restore should succeed");

    assert!(walk_for_file(&restore_target, "report.txt").is_some());
    assert!(walk_for_file(&restore_target, "beach.jpg").is_none());
}

#[tokio::test]
async fn wrong_password_is_classified_correctly() {
    require_restic!();

    let root = tempfile::tempdir().unwrap();
    let repo = root.path().join("repo");

    restic::init_repo(repo.to_str().unwrap(), Some("correct-password"))
        .await
        .expect("init repo");

    let err = restic::list_snapshots(repo.to_str().unwrap(), Some("wrong-password"))
        .await
        .expect_err("wrong password should fail");

    let app_error: AppError = err.into();
    assert_eq!(app_error, AppError::WrongPassword);
}

#[tokio::test]
async fn missing_repo_is_classified_correctly() {
    require_restic!();

    let root = tempfile::tempdir().unwrap();
    let nonexistent = root.path().join("does-not-exist");

    let err = restic::list_snapshots(nonexistent.to_str().unwrap(), Some("any-password"))
        .await
        .expect_err("missing repo should fail");

    let app_error: AppError = err.into();
    assert_eq!(app_error, AppError::RepoNotFound);
}

fn walk_for_file(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    for entry in std::fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = walk_for_file(&path, name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
    }
    None
}
