import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface Replica {
  id: string;
  label: string;
  repo_path: string;
}

export interface Repo {
  id: string;
  label: string;
  source_paths: string[];
  repo_path: string;
  replicas: Replica[];
}

export interface Snapshot {
  id: string;
  short_id: string;
  time: string;
  paths: string[];
}

export interface SnapshotFile {
  name: string;
  path: string;
  type: "dir" | "file";
}

export interface BackupSummary {
  total_files_processed?: number;
  files_new?: number;
  files_changed?: number;
}

export interface BackupEvent {
  message_type: string;
  percent_done?: number;
  files_done?: number;
  total_files?: number;
}

export interface AppError {
  kind: string;
  message?: string;
}

export function detectRestic(): Promise<void> {
  return invoke("detect_restic");
}

export function listRepos(): Promise<Repo[]> {
  return invoke("list_repos");
}

export function createRepo(args: {
  label: string;
  sourcePaths: string[];
  repoPath: string;
  password: string | null;
}): Promise<Repo> {
  return invoke("create_repo", args);
}

export function updateRepo(args: {
  repoId: string;
  label: string;
  sourcePaths: string[];
}): Promise<Repo> {
  return invoke("update_repo", args);
}

export function removeRepo(repoId: string): Promise<void> {
  return invoke("remove_repo", { repoId });
}

export function checkPathExists(path: string): Promise<boolean> {
  return invoke("check_path_exists", { path });
}

export function importResticRepo(args: {
  label: string;
  repoPath: string;
  password: string | null;
}): Promise<Repo> {
  return invoke("import_restic_repo", args);
}

export function relinkRepo(args: {
  repoId: string;
  newRepoPath: string;
}): Promise<Repo> {
  return invoke("relink_repo", args);
}

export function runBackup(repoId: string): Promise<BackupSummary> {
  return invoke("run_backup", { repoId });
}

export function listSnapshots(repoId: string): Promise<Snapshot[]> {
  return invoke("list_snapshots", { repoId });
}

export function listSnapshotFiles(args: {
  repoId: string;
  snapshotId: string;
  path: string;
}): Promise<SnapshotFile[]> {
  return invoke("list_snapshot_files", args);
}

export function restoreSnapshot(args: {
  repoId: string;
  snapshotId: string;
  targetPath: string;
  include: string[];
}): Promise<void> {
  return invoke("restore_snapshot", args);
}

export function addReplica(args: {
  repoId: string;
  label: string;
  repoPath: string;
  password: string;
}): Promise<Replica> {
  return invoke("add_replica", args);
}

export function runReplicate(args: {
  repoId: string;
  replicaId: string;
}): Promise<void> {
  return invoke("run_replicate", args);
}

export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export type GitProvider = "github" | "gitlab" | "forgejo";

export interface GitTarget {
  id: string;
  label: string;
  provider: GitProvider;
  server_url: string;
  username: string;
  dest_path: string;
  selected_repos: string[];
  created_at: string;
}

export interface RemoteRepo {
  owner: string;
  name: string;
  full_name: string;
  clone_url: string;
  private: boolean;
}

export interface LocalMirror {
  provider: string;
  owner: string;
  name: string;
  full_name: string;
  path: string;
}

export interface GitBackupSummary {
  repos_total: number;
  repos_succeeded: number;
  failures: string[];
}

export interface GitBackupProgress {
  current: number;
  total: number;
  full_name: string;
  status: "running" | "success" | "failed";
  message?: string;
}

export function detectGit(): Promise<string> {
  return invoke("detect_git");
}

export function installGit(): Promise<void> {
  return invoke("install_git");
}

export function fetchRemoteRepos(args: {
  provider: GitProvider;
  serverUrl: string;
  username: string;
  token: string;
}): Promise<RemoteRepo[]> {
  return invoke("fetch_remote_repos", args);
}

export function listGitTargets(): Promise<GitTarget[]> {
  return invoke("list_git_targets");
}

export function createGitTarget(args: {
  label: string;
  provider: GitProvider;
  serverUrl: string;
  username: string;
  token: string;
  destPath: string;
  selectedRepos: string[];
}): Promise<GitTarget> {
  return invoke("create_git_target", args);
}

export function updateGitTarget(args: {
  targetId: string;
  label: string;
  selectedRepos: string[];
}): Promise<GitTarget> {
  return invoke("update_git_target", args);
}

export function removeGitTarget(targetId: string): Promise<void> {
  return invoke("remove_git_target", { targetId });
}

export function relinkGitTarget(args: {
  targetId: string;
  newDestPath: string;
}): Promise<GitTarget> {
  return invoke("relink_git_target", args);
}

export function runGitBackup(targetId: string): Promise<GitBackupSummary> {
  return invoke("run_git_backup", { targetId });
}

export function listLocalGitRepos(targetId: string): Promise<LocalMirror[]> {
  return invoke("list_local_git_repos", { targetId });
}

export function restoreGitRepo(args: {
  targetId: string;
  barePath: string;
  targetPath: string;
}): Promise<void> {
  return invoke("restore_git_repo", args);
}
