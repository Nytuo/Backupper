use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "com.arnaud.backupper";
const REPOS_FILE: &str = "repos.json";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Replica {
    pub id: String,
    pub label: String,
    pub repo_path: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Repo {
    pub id: String,
    pub label: String,
    pub repo_path: String,
    pub source_paths: Vec<String>,
    #[serde(default)]
    pub replicas: Vec<Replica>,
    pub created_at: String,

    #[serde(default = "default_true")]
    pub encrypted: bool,
}

fn repos_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("could not resolve app config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(REPOS_FILE))
}

fn load_repos_from_path(path: &std::path::Path) -> Result<Vec<Repo>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn save_repos_to_path(path: &std::path::Path, repos: &[Repo]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(repos).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

pub fn load_repos(app: &AppHandle) -> Result<Vec<Repo>, String> {
    load_repos_from_path(&repos_file_path(app)?)
}

pub fn save_repos(app: &AppHandle, repos: &[Repo]) -> Result<(), String> {
    save_repos_to_path(&repos_file_path(app)?, repos)
}

pub fn set_password(account: &str, password: &str) -> Result<(), String> {
    let entry = keyring_core::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| e.to_string())
}

pub fn get_password(account: &str) -> Result<String, String> {
    let entry = keyring_core::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

pub fn replica_keyring_account(repo_id: &str, replica_id: &str) -> String {
    format!("{repo_id}::replica::{replica_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replica_keyring_account_is_namespaced_and_stable() {
        let account = replica_keyring_account("repo-1", "replica-1");
        assert_eq!(account, "repo-1::replica::replica-1");
    }

    #[test]
    fn load_repos_from_missing_path_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("repos.json");
        assert_eq!(load_repos_from_path(&path).unwrap(), Vec::<Repo>::new());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("repos.json");

        let repos = vec![Repo {
            id: "repo-1".to_string(),
            label: "My Laptop".to_string(),
            repo_path: "/tmp/backups/laptop".to_string(),
            source_paths: vec!["/home/me/docs".to_string()],
            replicas: vec![Replica {
                id: "replica-1".to_string(),
                label: "NAS".to_string(),
                repo_path: "/mnt/nas/laptop".to_string(),
            }],
            created_at: "1234567890".to_string(),
            encrypted: true,
        }];

        save_repos_to_path(&path, &repos).unwrap();
        let loaded = load_repos_from_path(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "repo-1");
        assert_eq!(loaded[0].replicas.len(), 1);
        assert_eq!(loaded[0].replicas[0].label, "NAS");
    }

    #[test]
    fn repos_missing_encrypted_field_default_to_true() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("repos.json");
        std::fs::write(
            &path,
            r#"[{"id":"repo-1","label":"Old Repo","repo_path":"/tmp/old","source_paths":[],"created_at":"0"}]"#,
        )
        .unwrap();
        let loaded = load_repos_from_path(&path).unwrap();
        assert!(loaded[0].encrypted);
    }

    #[test]
    fn load_repos_rejects_corrupt_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("repos.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(load_repos_from_path(&path).is_err());
    }
}
