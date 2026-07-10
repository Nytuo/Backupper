use serde::Serialize;

use crate::git_backup::GitError;
use crate::restic::ResticError;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppError {
    ResticNotFound,
    WrongPassword,
    RepoNotFound,
    ReplicaNotFound,
    RepoLocked,
    GitNotFound,
    GitTargetNotFound,
    GitNoInstaller,
    Io { message: String },
    Restic { message: String },
    Git { message: String },
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::ResticNotFound => write!(f, "restic was not found on your PATH"),
            AppError::WrongPassword => write!(f, "wrong password or no key found"),
            AppError::RepoNotFound => write!(f, "backup repository not found"),
            AppError::ReplicaNotFound => write!(f, "replication target not found"),
            AppError::RepoLocked => write!(f, "the repository is locked by another process"),
            AppError::GitNotFound => write!(f, "git was not found on your PATH"),
            AppError::GitTargetNotFound => write!(f, "this git backup target could not be found"),
            AppError::GitNoInstaller => {
                write!(f, "no supported package manager was found to install git")
            }
            AppError::Io { message } | AppError::Restic { message } | AppError::Git { message } => {
                write!(f, "{message}")
            }
        }
    }
}

impl From<ResticError> for AppError {
    fn from(err: ResticError) -> Self {
        match err {
            ResticError::NotFound => AppError::ResticNotFound,
            ResticError::Spawn(message) | ResticError::Parse(message) => {
                AppError::Restic { message }
            }
            ResticError::Failed(message) => classify_failed(message),
        }
    }
}

impl From<GitError> for AppError {
    fn from(err: GitError) -> Self {
        match err {
            GitError::NotFound => AppError::GitNotFound,
            GitError::NoInstaller => AppError::GitNoInstaller,
            GitError::Spawn(message) | GitError::Http(message) | GitError::Parse(message) => {
                AppError::Git { message }
            }
            GitError::Failed(message) => AppError::Git { message },
        }
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        AppError::Io { message }
    }
}

fn classify_failed(message: String) -> AppError {
    let lower = message.to_lowercase();
    if lower.contains("wrong password") || lower.contains("no key found") {
        AppError::WrongPassword
    } else if lower.contains("already locked") {
        AppError::RepoLocked
    } else if lower.contains("repository does not exist")
        || lower.contains("unable to open config file")
    {
        AppError::RepoNotFound
    } else {
        AppError::Restic { message }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_wrong_password() {
        let err: AppError =
            ResticError::Failed("Fatal: wrong password or no key found".to_string()).into();
        assert_eq!(err, AppError::WrongPassword);
    }

    #[test]
    fn classifies_missing_repo() {
        let err: AppError = ResticError::Failed(
            "Fatal: repository does not exist: unable to open config file: stat ... no such file or directory".to_string(),
        )
        .into();
        assert_eq!(err, AppError::RepoNotFound);
    }

    #[test]
    fn classifies_locked_repo() {
        let err: AppError = ResticError::Failed(
            "unable to create lock in backend: repository is already locked exclusively by PID 123"
                .to_string(),
        )
        .into();
        assert_eq!(err, AppError::RepoLocked);
    }

    #[test]
    fn falls_back_to_raw_message_for_unrecognized_errors() {
        let err: AppError =
            ResticError::Failed("Fatal: something completely new".to_string()).into();
        assert_eq!(
            err,
            AppError::Restic {
                message: "Fatal: something completely new".to_string()
            }
        );
    }

    #[test]
    fn restic_not_found_maps_directly() {
        let err: AppError = ResticError::NotFound.into();
        assert_eq!(err, AppError::ResticNotFound);
    }
}
