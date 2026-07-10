import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  Copy,
  HardDriveUpload,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n";
import { type BackupEvent, removeRepo, type Repo, runBackup } from "@/lib/api";

interface Props {
  repo: Repo;
  onBack: () => void;
  onGoRestore: () => void;
  onGoReplicate: () => void;
  onEdit: () => void;
  onRemoved: (repoId: string) => void;
}

export default function RepoView({
  repo,
  onBack,
  onGoRestore,
  onGoReplicate,
  onEdit,
  onRemoved,
}: Props) {
  const { t, errorMessage } = useI18n();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressText, setProgressText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  useEffect(() => {
    const unlisten = listen<BackupEvent>("backup-event", (event) => {
      const evt = event.payload;
      if (evt.message_type === "status") {
        const pct = Math.round((evt.percent_done || 0) * 100);
        setProgress(pct);
        setProgressText(
          t("repo.progressText", {
            percent: pct,
            filesDone: evt.files_done || 0,
            totalFiles: evt.total_files || 0,
          }),
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  async function backupNow() {
    setBusy(true);
    setResult(null);
    setProgress(0);
    setProgressText("");
    try {
      const summary = await runBackup(repo.id);
      setProgress(100);
      setProgressText(t("repo.progressDone"));
      setResult(
        t("repo.backupResultSuccess", {
          totalFiles: summary.total_files_processed ?? "?",
          filesNew: summary.files_new ?? 0,
          filesChanged: summary.files_changed ?? 0,
        }),
      );
    } catch (err) {
      setResult(t("repo.backupResultFailure", { message: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveRepo() {
    setRemoving(true);
    setRemoveError("");
    try {
      await removeRepo(repo.id);
      onRemoved(repo.id);
    } catch (err) {
      setRemoveError(errorMessage(err));
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={onBack}
        data-testid="btn-back"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-sm"
      >
        <ArrowLeft className="size-4" /> {t("repo.allBackupsLink")}
      </button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 data-testid="repo-title" className="text-2xl font-semibold">
            {repo.label}
          </h2>
          <p className="text-muted-foreground text-sm break-all">
            {repo.repo_path}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            data-testid="btn-edit-repo"
            className="gap-1.5"
          >
            <Pencil className="size-3.5" />
            {t("repo.editButton")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRemoveError("");
              setConfirmRemove(true);
            }}
            data-testid="btn-remove-repo"
            className="text-destructive hover:text-destructive gap-1.5"
          >
            <Trash2 className="size-3.5" />
            {t("repo.removeButton")}
          </Button>
        </div>
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent data-testid="remove-repo-dialog">
          <DialogHeader>
            <DialogTitle>{t("repo.removeConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("repo.removeConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p className="text-destructive text-sm">{removeError}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmRemove(false)}
              disabled={removing}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRemoveRepo}
              disabled={removing}
              data-testid="btn-confirm-remove-repo"
              className="gap-2"
            >
              {removing && <Loader2 className="size-4 animate-spin" />}
              {t("repo.removeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        onClick={backupNow}
        disabled={busy}
        size="lg"
        data-testid="btn-backup-now"
        className="h-12 gap-2 text-base"
      >
        {busy
          ? <Loader2 className="size-5 animate-spin" />
          : <HardDriveUpload className="size-5" />}
        {t("repo.backupNowButton")}
      </Button>

      {progress !== null && (
        <div className="flex flex-col gap-2">
          <Progress value={progress} className="h-3" />
          {progressText && (
            <p
              data-testid="backup-progress-text"
              className="text-muted-foreground text-sm"
            >
              {progressText}
            </p>
          )}
        </div>
      )}

      {result && (
        <p data-testid="backup-result" className="text-sm">
          {result}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={onGoRestore}
          data-testid="btn-go-restore"
          className="gap-2"
        >
          <RotateCcw className="size-4" />
          {t("repo.restoreButton")}
        </Button>
        <Button
          variant="outline"
          onClick={onGoReplicate}
          data-testid="btn-go-replicate"
          className="gap-2"
        >
          <Copy className="size-4" />
          {t("repo.replicateButton")}
        </Button>
      </div>
    </div>
  );
}
