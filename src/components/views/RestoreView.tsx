import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import {
  listSnapshotFiles,
  listSnapshots,
  pickFolder,
  type Repo,
  restoreSnapshot,
  type Snapshot,
  type SnapshotFile,
} from "@/lib/api";
import { pathBasename } from "@/lib/format";

interface Props {
  repo: Repo;
  onBack: () => void;
}

interface TreeNodeProps {
  repoId: string;
  snapshotId: string;
  path: string;
  name: string;
  kind: "dir" | "file";
  selected: Set<string>;
  onToggle: (path: string, checked: boolean) => void;
  depth: number;
}

function TreeNode({
  repoId,
  snapshotId,
  path,
  name,
  kind,
  selected,
  onToggle,
  depth,
}: TreeNodeProps) {
  const { t, errorMessage } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<SnapshotFile[]>([]);
  const [error, setError] = useState("");

  async function toggleExpand() {
    if (kind !== "dir") return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!loaded) {
      setLoading(true);
      try {
        const entries = await listSnapshotFiles({ repoId, snapshotId, path });
        setChildren(entries);
        setLoaded(true);
      } catch (err) {
        setError(errorMessage(err));
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  }

  return (
    <li data-testid="tree-node" data-path={path} data-kind={kind}>
      <div
        className="hover:bg-accent flex items-center gap-1.5 rounded-sm py-1 pr-2"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {kind === "dir"
          ? (
            <button
              onClick={toggleExpand}
              data-testid="tree-toggle"
              className="text-muted-foreground flex size-4 items-center justify-center"
            >
              {loading
                ? <Loader2 className="size-3.5 animate-spin" />
                : (
                  <ChevronRight
                    className={`size-3.5 transition-transform ${
                      expanded ? "rotate-90" : ""
                    }`}
                  />
                )}
            </button>
          )
          : <span className="size-4" />}

        <Checkbox
          data-testid="tree-checkbox"
          checked={selected.has(path)}
          onCheckedChange={(c) => onToggle(path, c === true)}
        />

        {kind === "dir"
          ? (
            expanded
              ? <FolderOpen className="text-muted-foreground size-4 shrink-0" />
              : <Folder className="text-muted-foreground size-4 shrink-0" />
          )
          : <File className="text-muted-foreground size-4 shrink-0" />}

        <button
          onClick={toggleExpand}
          data-testid="tree-name"
          className="truncate text-left text-sm"
        >
          {name}
        </button>
      </div>

      {expanded && (
        <ul>
          {error && (
            <li
              className="text-destructive py-1 text-xs"
              style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
            >
              {error}
            </li>
          )}
          {!error && loaded && children.length === 0 && (
            <li
              className="text-muted-foreground py-1 text-xs"
              style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
            >
              {t("restore.emptyFolder")}
            </li>
          )}
          {children.map((child) => (
            <TreeNode
              key={child.path}
              repoId={repoId}
              snapshotId={snapshotId}
              path={child.path}
              name={child.name}
              kind={child.type}
              selected={selected}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function RestoreView({ repo, onBack }: Props) {
  const { t, locale, errorMessage } = useI18n();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [snapshotsError, setSnapshotsError] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null,
  );
  const [destination, setDestination] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snaps = await listSnapshots(repo.id);
        if (!cancelled) setSnapshots(snaps);
      } catch (err) {
        if (!cancelled) setSnapshotsError(errorMessage(err));
      } finally {
        if (!cancelled) setLoadingSnapshots(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo.id, errorMessage]);

  useEffect(() => {
    const unlisten = listen<string>("restore-log", (event) => {
      setLog((prev) => [...prev, event.payload]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const selectedSnapshot = snapshots.find((s) => s.id === selectedSnapshotId);
  const canRestore = Boolean(selectedSnapshotId && destination);

  function selectSnapshot(id: string) {
    if (id === selectedSnapshotId) return;
    setSelectedSnapshotId(id);
    setTreeOpen(false);
    setSelectedPaths(new Set());
  }

  function toggleTree() {
    if (treeOpen) {
      setTreeOpen(false);
      setSelectedPaths(new Set());
    } else {
      setTreeOpen(true);
    }
  }

  function togglePath(path: string, checked: boolean) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  async function chooseDestination() {
    const folder = await pickFolder();
    if (folder) setDestination(folder);
  }

  async function run() {
    if (!repo || !selectedSnapshotId || !destination) return;
    setBusy(true);
    setLog([]);
    try {
      await restoreSnapshot({
        repoId: repo.id,
        snapshotId: selectedSnapshotId,
        targetPath: destination,
        include: Array.from(selectedPaths),
      });
      setLog((prev) => [...prev, t("restore.complete")]);
    } catch (err) {
      setLog((prev) => [
        ...prev,
        t("restore.failed", { message: errorMessage(err) }),
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-sm"
      >
        <ArrowLeft className="size-4" /> {t("common.back")}
      </button>

      <h2 className="text-2xl font-semibold">{t("restore.title")}</h2>

      {loadingSnapshots
        ? (
          <p className="text-muted-foreground text-sm">
            {t("restore.loadingSnapshots")}
          </p>
        )
        : snapshotsError
        ? <p className="text-destructive text-sm">{snapshotsError}</p>
        : snapshots.length === 0
        ? (
          <p className="text-muted-foreground text-sm">
            {t("restore.noSnapshots")}
          </p>
        )
        : (
          <div className="flex flex-col gap-1.5">
            {[...snapshots].reverse().map((snap) => (
              <button
                key={snap.id}
                data-testid="snapshot-item"
                onClick={() => selectSnapshot(snap.id)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  snap.id === selectedSnapshotId
                    ? "border-ring bg-accent"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                {new Date(snap.time).toLocaleString(locale)} ({snap.short_id})
              </button>
            ))}
          </div>
        )}

      <Button
        variant="outline"
        onClick={toggleTree}
        disabled={!selectedSnapshotId}
        data-testid="btn-toggle-file-picker"
        className="self-start"
      >
        {treeOpen
          ? t("restore.hideFilePickerButton")
          : t("restore.chooseSpecificButton")}
      </Button>

      {treeOpen && selectedSnapshot && (
        <div className="border-border rounded-md border">
          <ScrollArea className="h-64">
            <ul className="p-2">
              {selectedSnapshot.paths.map((rootPath) => (
                <TreeNode
                  key={rootPath}
                  repoId={repo.id}
                  snapshotId={selectedSnapshot.id}
                  path={rootPath}
                  name={pathBasename(rootPath)}
                  kind="dir"
                  selected={selectedPaths}
                  onToggle={togglePath}
                  depth={0}
                />
              ))}
            </ul>
          </ScrollArea>
          {selectedPaths.size > 0 && (
            <p
              data-testid="restore-selection-count"
              className="text-muted-foreground border-border border-t px-3 py-2 text-xs"
            >
              {t("restore.selectionCount", { count: selectedPaths.size })}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          {t("restore.destinationLabel")}
        </span>
        <p className="text-muted-foreground text-sm break-all">
          {destination ?? t("common.noFolderChosen")}
        </p>
        <Button
          variant="outline"
          onClick={chooseDestination}
          data-testid="btn-restore-destination"
          className="self-start"
        >
          {t("common.chooseFolder")}
        </Button>
      </div>

      <Button
        onClick={run}
        disabled={!canRestore || busy}
        data-testid="btn-restore-run"
        className="gap-2"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t("restore.runButton")}
      </Button>

      {log.length > 0 && (
        <div
          ref={logRef}
          data-testid="restore-log"
          className="bg-muted max-h-48 overflow-y-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap"
        >
          {log.join("\n")}
        </div>
      )}
    </div>
  );
}
