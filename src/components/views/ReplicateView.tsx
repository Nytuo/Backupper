import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import {
  addReplica,
  pickFolder,
  type Replica,
  type Repo,
  runReplicate,
} from "@/lib/api";

interface Props {
  repo: Repo;
  onBack: () => void;
  onReplicaAdded: (repoId: string, replica: Replica) => void;
}

export default function ReplicateView({ repo, onBack, onReplicaAdded }: Props) {
  const { t, errorMessage } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<string>("replicate-log", (event) => {
      setLog((prev) => [...prev, event.payload]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  function resetForm() {
    setLabel("");
    setDestination(null);
    setPassword("");
    setFormError("");
  }

  async function chooseDestination() {
    const folder = await pickFolder();
    if (folder) setDestination(folder);
  }

  async function create() {
    if (!label.trim()) return setFormError(t("replicate.errors.needName"));
    if (!destination) {
      return setFormError(t("replicate.errors.needDestination"));
    }
    if (!password) return setFormError(t("replicate.errors.needPassword"));

    setFormError("");
    setCreating(true);
    try {
      const replica = await addReplica({
        repoId: repo.id,
        label: label.trim(),
        repoPath: destination,
        password,
      });
      onReplicaAdded(repo.id, replica);
      setShowForm(false);
      resetForm();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function replicate(replicaId: string) {
    setRunningId(replicaId);
    setLog([]);
    try {
      await runReplicate({ repoId: repo.id, replicaId });
      setLog((prev) => [...prev, t("replicate.complete")]);
    } catch (err) {
      setLog((prev) => [
        ...prev,
        t("replicate.failed", { message: errorMessage(err) }),
      ]);
    } finally {
      setRunningId(null);
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

      <h2 className="text-2xl font-semibold">{t("replicate.title")}</h2>

      <div className="flex flex-col gap-2">
        {repo.replicas.length === 0
          ? (
            <p
              data-testid="no-replicas"
              className="text-muted-foreground text-sm"
            >
              {t("replicate.noTargets")}
            </p>
          )
          : (
            repo.replicas.map((replica) => (
              <Card
                key={replica.id}
                data-testid="replica-card"
                className="flex-row items-center justify-between gap-4 py-3"
              >
                <span className="min-w-0 truncate px-6 text-sm">
                  {replica.label} — {replica.repo_path}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="mr-6 gap-2"
                  data-testid="btn-replicate-now"
                  onClick={() => replicate(replica.id)}
                  disabled={runningId !== null}
                >
                  {runningId === replica.id && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {t("replicate.replicateNowButton")}
                </Button>
              </Card>
            ))
          )}
      </div>

      {!showForm && (
        <Button
          variant="outline"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          data-testid="btn-add-replica"
          className="gap-2 self-start"
        >
          <Plus className="size-4" />
          {t("replicate.addButton")}
        </Button>
      )}

      {showForm && (
        <Card className="gap-4 p-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="replica-label">{t("common.name")}</Label>
            <Input
              id="replica-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("replicate.namePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("replicate.locationLabel")}</Label>
            <p className="text-muted-foreground text-sm break-all">
              {destination ?? t("common.noFolderChosen")}
            </p>
            <Button
              variant="outline"
              onClick={chooseDestination}
              data-testid="btn-replica-choose"
              className="self-start"
            >
              {t("common.chooseFolder")}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="replica-password">{t("common.password")}</Label>
            <Input
              id="replica-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("replicate.passwordPlaceholder")}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("replicate.passwordHint")}
          </p>
          {formError && <p className="text-destructive text-sm">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowForm(false)}
              disabled={creating}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={create}
              disabled={creating}
              data-testid="btn-replica-create"
              className="gap-2"
            >
              {creating && <Loader2 className="size-4 animate-spin" />}
              {t("replicate.addTargetButton")}
            </Button>
          </div>
        </Card>
      )}

      {log.length > 0 && (
        <div
          ref={logRef}
          data-testid="replicate-log"
          className="bg-muted max-h-48 overflow-y-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap"
        >
          {log.join("\n")}
        </div>
      )}
    </div>
  );
}
