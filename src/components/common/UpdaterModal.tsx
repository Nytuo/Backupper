import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  AlertCircle,
  ArrowDownCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

type Phase =
  | "idle"
  | "downloading"
  | "installing"
  | "done"
  | "error"
  | "restart";

interface UpdateInfo {
  version: string;
  current_version: string;
  body: string | null;
  date: string | null;
}

interface ProgressPayload {
  stage: "downloading" | "installing" | "done";
  downloaded: number;
  total: number;
  percentage: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function UpdaterModal() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Register all event listeners on mount so no events are lost due to async registration
    const unlistenAvailable = listen<UpdateInfo>(
      "updater-update-available",
      (event) => {
        setUpdateInfo(event.payload);
        setPhase("idle");
        setOpen(true);
      },
    );

    const unlistenProgress = listen<ProgressPayload>(
      "updater-progress",
      (event) => {
        const { stage, downloaded, total, percentage } = event.payload;
        if (stage === "downloading") {
          setPhase("downloading");
          setDownloaded(downloaded);
          setTotal(total);
          setProgress(percentage);
        } else if (stage === "installing") {
          setPhase("installing");
          setProgress(99);
        } else if (stage === "done") {
          setPhase("restart");
          setProgress(100);
        }
      },
    );

    return () => {
      unlistenAvailable.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
    };
  }, []);

  async function handleInstall() {
    setPhase("downloading");
    setProgress(0);
    setErrorMsg("");

    try {
      await invoke("install_update");
    } catch (err) {
      setErrorMsg(String(err));
      setPhase("error");
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    setErrorMsg("");
    try {
      const info = await invoke<UpdateInfo | null>("check_for_update");
      if (info) {
        setUpdateInfo(info);
        setPhase("idle");
        setOpen(true);
      } else {
        setPhase("done");
        setUpdateInfo(null);
        setOpen(true);
      }
    } catch (err) {
      setErrorMsg(String(err));
      setPhase("error");
      setOpen(true);
    } finally {
      setChecking(false);
    }
  }

  async function handleOpenReleases() {
    await invoke("open_releases_page");
  }

  function handleRestart() {
    invoke("restart_app");
  }

  const isBlocked = phase === "downloading" || phase === "installing";

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCheckNow}
        disabled={checking}
        className="gap-1.5"
      >
        {checking
          ? <Loader2 className="size-3.5 animate-spin" />
          : <RefreshCw className="size-3.5" />}
        {t("updater.checkForUpdates")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isBlocked) setOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => {
            if (isBlocked) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (isBlocked) e.preventDefault();
          }}
          className="max-w-lg"
        >
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="text-primary size-5 shrink-0" />
                <DialogTitle>
                  {phase === "done" && !updateInfo
                    ? t("updater.upToDate")
                    : t("updater.updateAvailable")}
                </DialogTitle>
              </div>
              {!isBlocked && (
                <button
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground rounded-sm transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {updateInfo && (
              <DialogDescription asChild>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">
                    v{updateInfo.current_version}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-foreground font-semibold">
                    v{updateInfo.version}
                  </span>
                  {updateInfo.date && (
                    <span className="text-muted-foreground ml-1">
                      · {new Date(updateInfo.date).toLocaleDateString(locale, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </div>
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {updateInfo?.body && phase === "idle" && (
              <div className="bg-muted max-h-48 overflow-y-auto rounded-md px-3 py-2 text-sm">
                <pre className="font-sans whitespace-pre-wrap wrap-break-word">
                  {updateInfo.body}
                </pre>
              </div>
            )}

            {phase === "done" && !updateInfo && (
              <div className="flex items-center gap-2 rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>{t("updater.upToDateMessage")}</span>
              </div>
            )}

            {phase === "error" && (
              <div className="text-destructive border-destructive/50 bg-destructive/10 flex items-start gap-2 rounded-md border p-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {phase === "downloading" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("updater.downloading")}
                  </span>
                  <span className="font-medium tabular-nums">{progress}%</span>
                </div>
                <Progress value={progress} className="h-3" />
                {total > 0 && (
                  <p className="text-muted-foreground text-right text-xs tabular-nums">
                    {formatBytes(downloaded)} / {formatBytes(total)}
                  </p>
                )}
              </div>
            )}

            {phase === "installing" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("updater.installing")}
                  </span>
                  <span className="font-medium tabular-nums">99%</span>
                </div>
                <Progress value={99} className="h-3" />
              </div>
            )}

            {phase === "restart" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span>{t("updater.installedRestart")}</span>
                </div>
                <Button onClick={handleRestart} className="w-full gap-2">
                  <RefreshCw className="size-4" />
                  {t("updater.restartNow")}
                </Button>
              </div>
            )}

            {(phase === "idle" || phase === "error") && (
              <div className="flex flex-col gap-2">
                {updateInfo && (
                  <Button
                    onClick={handleInstall}
                    className="w-full gap-2"
                    disabled={checking}
                  >
                    <ArrowDownCircle className="size-4" />
                    {phase === "error"
                      ? t("updater.retryUpdate")
                      : t("updater.updateNow")}
                  </Button>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-1.5"
                    onClick={handleOpenReleases}
                  >
                    <ExternalLink className="size-3.5" />
                    {t("updater.allReleases")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setOpen(false)}
                    disabled={isBlocked}
                  >
                    {t("updater.later")}
                  </Button>
                </div>
              </div>
            )}

            {phase === "done" && !updateInfo && (
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("updater.close")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
