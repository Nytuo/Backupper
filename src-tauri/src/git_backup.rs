use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::restic::ProgressEmitter;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git was not found on your PATH.")]
    NotFound,
    #[error("failed to launch git: {0}")]
    Spawn(String),
    #[error("{0}")]
    Failed(String),
    #[error("could not reach the server: {0}")]
    Http(String),
    #[error("failed to parse server response: {0}")]
    Parse(String),
    #[error("no supported package manager was found to install git automatically")]
    NoInstaller,
}

impl From<reqwest::Error> for GitError {
    fn from(err: reqwest::Error) -> Self {
        GitError::Http(err.to_string())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitProvider {
    Github,
    Gitlab,
    Forgejo,
}

impl GitProvider {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "github" => Some(GitProvider::Github),
            "gitlab" => Some(GitProvider::Gitlab),
            "forgejo" => Some(GitProvider::Forgejo),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            GitProvider::Github => "github",
            GitProvider::Gitlab => "gitlab",
            GitProvider::Forgejo => "forgejo",
        }
    }

    pub fn default_server_url(&self) -> &'static str {
        match self {
            GitProvider::Github => "https://api.github.com",
            GitProvider::Gitlab => "https://gitlab.com",
            GitProvider::Forgejo => "",
        }
    }
}

pub async fn detect_git() -> Result<String, GitError> {
    let output = Command::new("git")
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|_| GitError::NotFound)?;
    if !output.status.success() {
        return Err(GitError::NotFound);
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn find_on_path(bin: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| {
                let candidate = dir.join(bin);
                candidate.is_file()
            })
        })
        .unwrap_or(false)
}

fn install_command() -> Result<Command, GitError> {
    if cfg!(target_os = "macos") {
        let mut cmd = Command::new("brew");
        cmd.args(["install", "git"]);
        return Ok(cmd);
    }
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("winget");
        cmd.args([
            "install", "--id", "Git.Git", "-e", "--source", "winget",
            "--accept-source-agreements", "--accept-package-agreements",
        ]);
        return Ok(cmd);
    }
    let (pm, args): (&str, &[&str]) = if find_on_path("apt-get") {
        ("apt-get", &["install", "-y", "git"])
    } else if find_on_path("dnf") {
        ("dnf", &["install", "-y", "git"])
    } else if find_on_path("pacman") {
        ("pacman", &["-S", "--noconfirm", "git"])
    } else if find_on_path("zypper") {
        ("zypper", &["install", "-y", "git"])
    } else {
        return Err(GitError::NoInstaller);
    };

    let mut cmd = if find_on_path("pkexec") {
        let mut c = Command::new("pkexec");
        c.arg(pm).args(args);
        c
    } else {
        let mut c = Command::new(pm);
        c.args(args);
        c
    };
    cmd.env("DEBIAN_FRONTEND", "noninteractive");
    Ok(cmd)
}

pub async fn install_git(emitter: Arc<dyn ProgressEmitter>) -> Result<(), GitError> {
    let mut cmd = install_command()?;
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    run_log_streaming(emitter, cmd, "git-install-log").await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteRepo {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub clone_url: String,
    pub private: bool,
}

fn http_client() -> Result<reqwest::Client, GitError> {
    reqwest::Client::builder()
        .user_agent("Backupper")
        .build()
        .map_err(GitError::from)
}

fn non_empty_server(provider: GitProvider, server_url: &str) -> Result<String, GitError> {
    let trimmed = server_url.trim().trim_end_matches('/');
    if !trimmed.is_empty() {
        return Ok(trimmed.to_string());
    }
    let default = provider.default_server_url();
    if default.is_empty() {
        return Err(GitError::Failed(
            "a server URL is required for this provider".to_string(),
        ));
    }
    Ok(default.to_string())
}

pub async fn fetch_remote_repos(
    provider: GitProvider,
    server_url: &str,
    username: &str,
    token: &str,
) -> Result<Vec<RemoteRepo>, GitError> {
    let server = non_empty_server(provider, server_url)?;
    let client = http_client()?;
    let mut repos = Vec::new();
    let mut page = 1u32;

    loop {
        let (request, per_page) = match provider {
            GitProvider::Github => (
                client
                    .get(format!("{server}/user/repos"))
                    .query(&[("per_page", "100"), ("page", &page.to_string())])
                    .bearer_auth(token)
                    .header("Accept", "application/vnd.github+json"),
                100,
            ),
            GitProvider::Gitlab => (
                client
                    .get(format!("{server}/api/v4/projects"))
                    .query(&[
                        ("membership", "true"),
                        ("per_page", "100"),
                        ("page", &page.to_string()),
                    ])
                    .header("PRIVATE-TOKEN", token),
                100,
            ),
            GitProvider::Forgejo => (
                client
                    .get(format!("{server}/api/v1/user/repos"))
                    .query(&[("limit", "50"), ("page", &page.to_string())])
                    .header("Authorization", format!("token {token}")),
                50,
            ),
        };

        let response = request.send().await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(GitError::Failed(format!(
                "server responded with {status}: {body}"
            )));
        }
        let value: serde_json::Value = response.json().await?;
        let items = value
            .as_array()
            .cloned()
            .ok_or_else(|| GitError::Parse("expected a JSON array of repos".to_string()))?;
        let count = items.len();

        for item in items {
            if let Some(repo) = parse_repo(provider, &item) {
                repos.push(repo);
            }
        }

        if count < per_page {
            break;
        }
        page += 1;
    }

    let _ = username;
    Ok(repos)
}

fn parse_repo(provider: GitProvider, item: &serde_json::Value) -> Option<RemoteRepo> {
    match provider {
        GitProvider::Github | GitProvider::Forgejo => {
            let name = item.get("name")?.as_str()?.to_string();
            let full_name = item
                .get("full_name")
                .and_then(|v| v.as_str())
                .unwrap_or(&name)
                .to_string();
            let clone_url = item.get("clone_url")?.as_str()?.to_string();
            let owner = item
                .get("owner")
                .and_then(|o| o.get("login"))
                .and_then(|v| v.as_str())
                .unwrap_or_else(|| full_name.split('/').next().unwrap_or(&name))
                .to_string();
            let private = item
                .get("private")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Some(RemoteRepo {
                owner,
                name,
                full_name,
                clone_url,
                private,
            })
        }
        GitProvider::Gitlab => {
            let name = item.get("name")?.as_str()?.to_string();
            let full_name = item
                .get("path_with_namespace")
                .and_then(|v| v.as_str())
                .unwrap_or(&name)
                .to_string();
            let clone_url = item.get("http_url_to_repo")?.as_str()?.to_string();
            let owner = item
                .get("namespace")
                .and_then(|n| n.get("full_path"))
                .and_then(|v| v.as_str())
                .unwrap_or_else(|| full_name.split('/').next().unwrap_or(&name))
                .to_string();
            let private = item
                .get("visibility")
                .and_then(|v| v.as_str())
                .map(|v| v != "public")
                .unwrap_or(true);
            Some(RemoteRepo {
                owner,
                name,
                full_name,
                clone_url,
                private,
            })
        }
    }
}

fn authenticated_url(clone_url: &str, username: &str, token: &str) -> String {
    if let Some(rest) = clone_url.strip_prefix("https://") {
        let user = if username.trim().is_empty() {
            "git"
        } else {
            username.trim()
        };
        format!("https://{user}:{token}@{rest}")
    } else {
        clone_url.to_string()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalMirror {
    pub provider: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub path: String,
}

pub fn mirror_dir(dest_root: &str, provider: GitProvider, repo: &RemoteRepo) -> PathBuf {
    Path::new(dest_root)
        .join(provider.as_str())
        .join(&repo.owner)
        .join(format!("{}.git", repo.name))
}

pub async fn mirror_repo(
    emitter: Arc<dyn ProgressEmitter>,
    dest_root: &str,
    provider: GitProvider,
    repo: &RemoteRepo,
    username: &str,
    token: &str,
) -> Result<(), GitError> {
    let repo_dir = mirror_dir(dest_root, provider, repo);
    let auth_url = authenticated_url(&repo.clone_url, username, token);

    if repo_dir.exists() {
        emitter.emit(
            "git-backup-log",
            serde_json::Value::String(format!("Updating {}...", repo.full_name)),
        );
        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(&repo_dir)
            .arg("remote")
            .arg("set-url")
            .arg("origin")
            .arg(&auth_url);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        run_silent(cmd).await?;

        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(&repo_dir)
            .arg("remote")
            .arg("update")
            .arg("--prune");
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        run_log_streaming(emitter, cmd, "git-backup-log").await
    } else {
        emitter.emit(
            "git-backup-log",
            serde_json::Value::String(format!("Cloning {}...", repo.full_name)),
        );
        if let Some(parent) = repo_dir.parent() {
            std::fs::create_dir_all(parent).map_err(|e| GitError::Spawn(e.to_string()))?;
        }
        let mut cmd = Command::new("git");
        cmd.arg("clone").arg("--mirror").arg(&auth_url).arg(&repo_dir);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        run_log_streaming(emitter, cmd, "git-backup-log").await
    }
}

pub fn list_local_mirrors(dest_root: &str) -> Vec<LocalMirror> {
    let mut mirrors = Vec::new();
    let root = Path::new(dest_root);
    let Ok(providers) = std::fs::read_dir(root) else {
        return mirrors;
    };
    for provider_entry in providers.flatten() {
        if !provider_entry.path().is_dir() {
            continue;
        }
        let provider = provider_entry.file_name().to_string_lossy().to_string();
        let Ok(owners) = std::fs::read_dir(provider_entry.path()) else {
            continue;
        };
        for owner_entry in owners.flatten() {
            if !owner_entry.path().is_dir() {
                continue;
            }
            let owner = owner_entry.file_name().to_string_lossy().to_string();
            let Ok(repos) = std::fs::read_dir(owner_entry.path()) else {
                continue;
            };
            for repo_entry in repos.flatten() {
                let file_name = repo_entry.file_name().to_string_lossy().to_string();
                let Some(name) = file_name.strip_suffix(".git") else {
                    continue;
                };
                mirrors.push(LocalMirror {
                    provider: provider.clone(),
                    owner: owner.clone(),
                    name: name.to_string(),
                    full_name: format!("{owner}/{name}"),
                    path: repo_entry.path().to_string_lossy().to_string(),
                });
            }
        }
    }
    mirrors.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    mirrors
}

pub async fn restore_mirror(
    emitter: Arc<dyn ProgressEmitter>,
    bare_path: &str,
    target_path: &str,
) -> Result<(), GitError> {
    let mut cmd = Command::new("git");
    cmd.arg("clone").arg(bare_path).arg(target_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    run_log_streaming(emitter, cmd, "git-restore-log").await
}

async fn run_silent(mut cmd: Command) -> Result<(), GitError> {
    let output = cmd
        .output()
        .await
        .map_err(|e| GitError::Spawn(e.to_string()))?;
    if !output.status.success() {
        return Err(GitError::Failed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

async fn run_log_streaming(
    emitter: Arc<dyn ProgressEmitter>,
    mut cmd: Command,
    event_name: &'static str,
) -> Result<(), GitError> {
    let mut child = cmd.spawn().map_err(|e| GitError::Spawn(e.to_string()))?;
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
        .map_err(|e| GitError::Spawn(e.to_string()))?;
    let stderr_lines = stderr_task
        .await
        .map_err(|e| GitError::Spawn(e.to_string()))?;

    let status = child
        .wait()
        .await
        .map_err(|e| GitError::Spawn(e.to_string()))?;

    if !status.success() {
        return Err(GitError::Failed(if stderr_lines.is_empty() {
            "git exited with an error".to_string()
        } else {
            stderr_lines.join("\n")
        }));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authenticated_url_injects_credentials() {
        let url = authenticated_url("https://github.com/octocat/hello.git", "octocat", "tok123");
        assert_eq!(url, "https://octocat:tok123@github.com/octocat/hello.git");
    }

    #[test]
    fn authenticated_url_defaults_username() {
        let url = authenticated_url("https://gitlab.com/group/proj.git", "", "tok123");
        assert_eq!(url, "https://git:tok123@gitlab.com/group/proj.git");
    }

    #[test]
    fn authenticated_url_leaves_non_https_untouched() {
        let url = authenticated_url("git@github.com:octocat/hello.git", "octocat", "tok123");
        assert_eq!(url, "git@github.com:octocat/hello.git");
    }

    #[test]
    fn parse_github_repo() {
        let json = serde_json::json!({
            "name": "hello",
            "full_name": "octocat/hello",
            "clone_url": "https://github.com/octocat/hello.git",
            "private": true,
            "owner": {"login": "octocat"}
        });
        let repo = parse_repo(GitProvider::Github, &json).unwrap();
        assert_eq!(repo.owner, "octocat");
        assert_eq!(repo.name, "hello");
        assert!(repo.private);
    }

    #[test]
    fn parse_gitlab_repo() {
        let json = serde_json::json!({
            "name": "hello",
            "path_with_namespace": "group/hello",
            "http_url_to_repo": "https://gitlab.com/group/hello.git",
            "visibility": "private",
            "namespace": {"full_path": "group"}
        });
        let repo = parse_repo(GitProvider::Gitlab, &json).unwrap();
        assert_eq!(repo.owner, "group");
        assert_eq!(repo.full_name, "group/hello");
        assert!(repo.private);
    }

    #[test]
    fn mirror_dir_layout() {
        let repo = RemoteRepo {
            owner: "octocat".to_string(),
            name: "hello".to_string(),
            full_name: "octocat/hello".to_string(),
            clone_url: "https://github.com/octocat/hello.git".to_string(),
            private: false,
        };
        let dir = mirror_dir("/tmp/backups", GitProvider::Github, &repo);
        assert_eq!(dir, PathBuf::from("/tmp/backups/github/octocat/hello.git"));
    }

    #[test]
    fn list_local_mirrors_scans_layout() {
        let dir = tempfile::tempdir().unwrap();
        let repo_dir = dir.path().join("github").join("octocat").join("hello.git");
        std::fs::create_dir_all(&repo_dir).unwrap();
        let mirrors = list_local_mirrors(dir.path().to_str().unwrap());
        assert_eq!(mirrors.len(), 1);
        assert_eq!(mirrors[0].full_name, "octocat/hello");
        assert_eq!(mirrors[0].provider, "github");
    }
}
