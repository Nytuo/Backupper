import { useState } from "react";
import {
  ArrowLeft,
  FolderPlus,
  HardDrive,
  Loader2,
  Lock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import { createRepo, pickFolder, type Repo, updateRepo } from "@/lib/api";

interface Props {
  editRepo?: Repo | null;
  onCancel: () => void;
  onDone: (repo: Repo) => void;
}

export default function SetupView({ editRepo, onCancel, onDone }: Props) {
  const { t, errorMessage } = useI18n();
  const isEdit = Boolean(editRepo);
  const [label, setLabel] = useState(editRepo?.label ?? "");
  const [sources, setSources] = useState<string[]>(
    editRepo?.source_paths ?? [],
  );
  const [destination, setDestination] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function addSource() {
    const folder = await pickFolder();
    if (folder && !sources.includes(folder)) setSources([...sources, folder]);
  }

  async function chooseDestination() {
    const folder = await pickFolder();
    if (folder) setDestination(folder);
  }

  async function submit() {
    if (!label.trim()) return setError(t("setup.errors.needName"));
    if (sources.length === 0) return setError(t("setup.errors.needSource"));

    setError("");
    setBusy(true);
    try {
      if (isEdit && editRepo) {
        const repo = await updateRepo({
          repoId: editRepo.id,
          label: label.trim(),
          sourcePaths: sources,
        });
        onDone(repo);
      } else {
        if (!destination) return setError(t("setup.errors.needDestination"));
        if (password && password !== confirm) {
          return setError(t("setup.errors.passwordMismatch"));
        }
        const repo = await createRepo({
          label: label.trim(),
          sourcePaths: sources,
          repoPath: destination,
          password: password || null,
        });
        onDone(repo);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={onCancel}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-sm"
      >
        <ArrowLeft className="size-4" />{" "}
        {isEdit ? t("common.back") : t("repo.allBackupsLink")}
      </button>

      <h2 className="text-2xl font-semibold">
        {isEdit ? t("setup.editTitle") : t("setup.title")}
      </h2>

      <div className="flex flex-col gap-2">
        <Label htmlFor="setup-label">{t("common.name")}</Label>
        <Input
          id="setup-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("setup.namePlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("setup.sourcesLabel")}</Label>
        <ul className="flex flex-col gap-2">
          {sources.map((path) => (
            <li
              key={path}
              data-testid="setup-source"
              className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm"
            >
              <span className="truncate">{path}</span>
              <button
                onClick={() => setSources(sources.filter((p) => p !== path))}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label={t("common.remove")}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          onClick={addSource}
          data-testid="btn-add-source"
          className="gap-2 self-start"
        >
          <FolderPlus className="size-4" />
          {t("setup.addFolderButton")}
        </Button>
      </div>

      {isEdit
        ? (
          <div className="text-muted-foreground flex items-start gap-2 text-xs">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("setup.destinationLocked")}</span>
          </div>
        )
        : (
          <>
            <div className="flex flex-col gap-2">
              <Label>{t("setup.destinationLabel")}</Label>
              <p className="text-muted-foreground text-sm break-all">
                {destination ?? t("common.noFolderChosen")}
              </p>
              <Button
                variant="outline"
                onClick={chooseDestination}
                data-testid="btn-choose-destination"
                className="gap-2 self-start"
              >
                <HardDrive className="size-4" />
                {t("setup.chooseDestinationButton")}
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setup-password">{t("setup.passwordLabel")}</Label>
              <Input
                id="setup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("setup.passwordPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="setup-confirm">
                {t("setup.confirmPasswordLabel")}
              </Label>
              <Input
                id="setup-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("setup.confirmPasswordPlaceholder")}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {t("setup.passwordHint")}
            </p>
          </>
        )}

      {error && (
        <p data-testid="setup-error" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={submit}
          disabled={busy}
          data-testid="btn-setup-submit"
          className="gap-2"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {isEdit ? t("setup.saveButton") : t("setup.createButton")}
        </Button>
      </div>
    </div>
  );
}
