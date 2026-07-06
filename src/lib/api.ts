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
