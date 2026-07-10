import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  type GitTarget,
  type LocalMirror,
  listLocalGitRepos,
  pickFolder,
  restoreGitRepo,
} from "@/lib/api";

interface Props {
  target: GitTarget;
  onBack: () => void;
}

export default function GitRestoreView({ target, onBack }: Props) {
  const { t, errorMessage } = useI18n();
  const [mirrors, setMirrors] = useState<LocalMirror[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<LocalMirror | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listLocalGitRepos(target.id);
        if (!cancelled) setMirrors(list);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.id, errorMessage]);

  useEffect(() => {
    const unlisten = listen<string>("git-restore-log", (event) => {
      setLog((prev) => [...prev, event.payload]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function chooseDestination() {
    const folder = await pickFolder();
    if (folder) setDestination(folder);
  }

  async function run() {
    if (!selected || !destination) return;
    setBusy(true);
    setLog([]);
    try {
      await restoreGitRepo({
        targetId: target.id,
        barePath: selected.path,
        targetPath: `${destination}/${selected.name}`,
      });
      setLog((prev) => [...prev, t("gitRestore.complete")]);
    } catch (err) {
      setLog((prev) => [...prev, t("gitRestore.failed", { message: errorMessage(err) })]);
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

      <h2 className="text-2xl font-semibold">{t("gitRestore.title")}</h2>

      {loading
        ? <p className="text-muted-foreground text-sm">{t("gitRestore.loading")}</p>
        : loadError
        ? <p className="text-destructive text-sm">{loadError}</p>
        : mirrors.length === 0
        ? <p className="text-muted-foreground text-sm">{t("gitRestore.noMirrors")}</p>
        : (
          <div className="flex flex-col gap-1.5">
            {mirrors.map((mirror) => (
              <button
                key={mirror.path}
                data-testid="git-mirror-item"
                onClick={() => setSelected(mirror)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  selected?.path === mirror.path
                    ? "border-ring bg-accent"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                {mirror.full_name}
              </button>
            ))}
          </div>
        )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("gitRestore.destinationLabel")}</span>
        <p className="text-muted-foreground text-sm break-all">
          {destination ?? t("common.noFolderChosen")}
        </p>
        <Button
          variant="outline"
          onClick={chooseDestination}
          data-testid="btn-git-restore-destination"
          className="w-fit"
        >
          {t("common.chooseFolder")}
        </Button>
      </div>

      <Button
        onClick={run}
        disabled={!selected || !destination || busy}
        data-testid="btn-git-restore-run"
        className="w-fit gap-2"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t("gitRestore.runButton")}
      </Button>

      {log.length > 0 && (
        <div
          ref={logRef}
          data-testid="git-restore-log"
          className="bg-muted max-h-48 overflow-y-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap"
        >
          {log.join("\n")}
        </div>
      )}
    </div>
  );
}
