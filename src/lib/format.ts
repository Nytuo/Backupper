import type { Snapshot } from "@/lib/api";

export function canRestore(
  selectedSnapshotId: string | null,
  restoreDestination: string | null,
): boolean {
  return Boolean(selectedSnapshotId && restoreDestination);
}

export function formatSnapshotLabel(
  locale: string,
  snapshot: Pick<Snapshot, "time" | "short_id">,
): string {
  return `${
    new Date(snapshot.time).toLocaleString(locale)
  } (${snapshot.short_id})`;
}

export function pathBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}
