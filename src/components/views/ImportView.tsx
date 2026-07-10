import { useState } from "react";
import { ArrowLeft, Download, HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import { importResticRepo, pickFolder, type Repo } from "@/lib/api";

interface Props {
  onCancel: () => void;
  onDone: (repo: Repo) => void;
}

export default function ImportView({ onCancel, onDone }: Props) {
  const { t, errorMessage } = useI18n();
  const [label, setLabel] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function chooseSource() {
    const folder = await pickFolder();
    if (folder) {
      setSource(folder);
      setNeedsPassword(false);
      setError("");
    }
  }

  async function submit() {
    if (!label.trim()) return setError(t("import.errors.needName"));
    if (!source) return setError(t("import.errors.needSource"));

    setError("");
    setBusy(true);
    try {
      const repo = await importResticRepo({
        label: label.trim(),
        repoPath: source,
        password: password || null,
      });
      onDone(repo);
    } catch (err) {
      const kind = err && typeof err === "object" ? (err as { kind?: string }).kind : undefined;
      if (kind === "wrong_password") {
        setNeedsPassword(true);
        setError(t("import.errors.wrongPassword"));
      } else if (kind === "repo_not_found") {
        setError(t("import.errors.notARepo"));
      } else {
        setError(errorMessage(err));
      }
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
        <ArrowLeft className="size-4" /> {t("common.back")}
      </button>

      <h2 className="text-2xl font-semibold">{t("import.title")}</h2>
      <p className="text-muted-foreground text-sm">{t("import.description")}</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="import-label">{t("common.name")}</Label>
        <Input
          id="import-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("import.namePlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("import.sourceLabel")}</Label>
        <p className="text-muted-foreground text-sm break-all">
          {source ?? t("common.noFolderChosen")}
        </p>
        <Button
          variant="outline"
          onClick={chooseSource}
          data-testid="btn-import-source"
          className="w-fit gap-2"
        >
          <HardDrive className="size-4" />
          {t("import.chooseSourceButton")}
        </Button>
      </div>

      {needsPassword && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-password">{t("common.password")}</Label>
          <Input
            id="import-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("import.passwordPlaceholder")}
            data-testid="import-password"
          />
        </div>
      )}

      {error && (
        <p data-testid="import-error" className="text-destructive text-sm">
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
          data-testid="btn-import-submit"
          className="gap-2"
        >
          {busy
            ? <Loader2 className="size-4 animate-spin" />
            : <Download className="size-4" />}
          {t("import.importButton")}
        </Button>
      </div>
    </div>
  );
}
