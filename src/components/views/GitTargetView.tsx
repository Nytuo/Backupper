import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ChevronRight,
  FolderGit2,
  Loader2,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import {
  type GitBackupProgress,
  type GitTarget,
  removeGitTarget,
  runGitBackup,
} from "@/lib/api";

interface Props {
  target: GitTarget;
  onBack: () => void;
  onGoRestore: () => void;
  onRemoved: (targetId: string) => void;
}

export default function GitTargetView(
  { target, onBack, onGoRestore, onRemoved }: Props,
) {
  const { t, errorMessage } = useI18n();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GitBackupProgress | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<GitBackupProgress>("git-backup-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("git-backup-log", (event) => {
      setOutput((prev) => [...prev, event.payload]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (advancedOpen && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, advancedOpen]);

  async function backupNow() {
    setBusy(true);
    setResult(null);
    setOutput([]);
    setProgress(null);
    try {
      const summary = await runGitBackup(target.id);
      if (summary.failures.length === 0) {
        setResult(
          t("gitTarget.backupResultSuccess", {
            succeeded: summary.repos_succeeded,
            total: summary.repos_total,
          }),
        );
      } else {
        setResult(
          t("gitTarget.backupResultPartial", {
            succeeded: summary.repos_succeeded,
            total: summary.repos_total,
            failures: summary.failures.join("; "),
          }),
        );
      }
    } catch (err) {
      setResult(t("gitTarget.backupResultFailure", { message: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  }

  const percent = progress && progress.total > 0
    ? Math.round(((progress.current - (progress.status === "running" ? 1 : 0)) / progress.total) * 100)
    : 0;

  const progressText = progress
    ? progress.status === "running"
      ? t("gitTarget.progressRunning", {
        current: progress.current,
        total: progress.total,
        repo: progress.full_name,
      })
      : progress.status === "failed"
      ? t("gitTarget.progressFailed", {
        current: progress.current,
        total: progress.total,
        repo: progress.full_name,
      })
      : t("gitTarget.progressSuccess", {
        current: progress.current,
        total: progress.total,
        repo: progress.full_name,
      })
    : t("gitTarget.progressIdle");

  async function confirmRemoveTarget() {
    setRemoving(true);
    setRemoveError("");
    try {
      await removeGitTarget(target.id);
      onRemoved(target.id);
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
          <h2 data-testid="git-target-title" className="text-2xl font-semibold">
            {target.label}
          </h2>
          <p className="text-muted-foreground text-sm break-all">
            {t("gitTarget.summary", {
              provider: t(`gitSetup.providers.${target.provider}`),
              count: target.selected_repos.length || 0,
              path: target.dest_path,
            })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setRemoveError("");
            setConfirmRemove(true);
          }}
          data-testid="btn-remove-git-target"
          className="text-destructive hover:text-destructive shrink-0 gap-1.5"
        >
          <Trash2 className="size-3.5" />
          {t("gitTarget.removeButton")}
        </Button>
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent data-testid="remove-git-target-dialog">
          <DialogHeader>
            <DialogTitle>{t("gitTarget.removeConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("gitTarget.removeConfirmDescription")}
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
              onClick={confirmRemoveTarget}
              disabled={removing}
              data-testid="btn-confirm-remove-git-target"
              className="gap-2"
            >
              {removing && <Loader2 className="size-4 animate-spin" />}
              {t("gitTarget.removeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        onClick={backupNow}
        disabled={busy}
        size="lg"
        data-testid="btn-git-backup-now"
        className="h-12 gap-2 text-base"
      >
        {busy
          ? <Loader2 className="size-5 animate-spin" />
          : <FolderGit2 className="size-5" />}
        {t("gitTarget.backupNowButton")}
      </Button>

      <div className="flex flex-col gap-2">
        <Progress
          value={progress ? percent : 0}
          className="h-3"
          data-testid="git-backup-progress-bar"
        />
        <p
          data-testid="git-backup-progress-text"
          className="text-muted-foreground text-sm"
        >
          {progressText}
        </p>
      </div>

      {result && (
        <p data-testid="git-backup-result" className="text-sm">
          {result}
        </p>
      )}

      <div className="border-border rounded-md border">
        <button
          onClick={() => setAdvancedOpen((prev) => !prev)}
          data-testid="btn-toggle-advanced"
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm"
        >
          <ChevronRight
            className={`size-4 shrink-0 transition-transform ${
              advancedOpen ? "rotate-90" : ""
            }`}
          />
          {t("gitTarget.advancedToggle")}
        </button>
        {advancedOpen && (
          <ScrollArea className="border-border h-48 border-t">
            <div
              ref={outputRef}
              data-testid="git-backup-log"
              className="bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
            >
              {output.length > 0 ? output.join("\n") : t("gitTarget.advancedEmpty")}
            </div>
          </ScrollArea>
        )}
      </div>

      <Button
        variant="outline"
        onClick={onGoRestore}
        data-testid="btn-go-git-restore"
        className="w-fit gap-2"
      >
        <RotateCcw className="size-4" />
        {t("gitTarget.restoreButton")}
      </Button>
    </div>
  );
}
