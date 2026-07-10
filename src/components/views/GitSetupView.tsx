import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Check, Download, FolderGit2, HardDrive, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/i18n";
import {
  createGitTarget,
  detectGit,
  fetchRemoteRepos,
  type GitProvider,
  type GitTarget,
  installGit,
  pickFolder,
  type RemoteRepo,
} from "@/lib/api";

interface Props {
  onCancel: () => void;
  onDone: (target: GitTarget) => void;
}

const DEFAULT_SERVER: Record<GitProvider, string> = {
  github: "https://api.github.com",
  gitlab: "https://gitlab.com",
  forgejo: "",
};

export default function GitSetupView({ onCancel, onDone }: Props) {
  const { t, errorMessage } = useI18n();
  const [gitReady, setGitReady] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<GitProvider>("github");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER.github);
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [destination, setDestination] = useState<string | null>(null);

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await detectGit();
        setGitReady(true);
      } catch {
        setGitReady(false);
      }
    })();
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("git-install-log", (event) => {
      setInstallLog((prev) => [...prev, event.payload]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [installLog]);

  function changeProvider(next: GitProvider) {
    setProvider(next);
    setServerUrl(DEFAULT_SERVER[next]);
    setRemoteRepos(null);
    setSelected(new Set());
  }

  async function runInstallGit() {
    setInstalling(true);
    setInstallError("");
    setInstallLog([]);
    try {
      await installGit();
      await detectGit();
      setGitReady(true);
    } catch (err) {
      setInstallError(errorMessage(err));
    } finally {
      setInstalling(false);
    }
  }

  async function chooseDestination() {
    const folder = await pickFolder();
    if (folder) setDestination(folder);
  }

  async function doFetchRepos() {
    if (!username.trim() || !token.trim()) {
      return setFetchError(t("gitSetup.errors.needCredentials"));
    }
    if (provider === "forgejo" && !serverUrl.trim()) {
      return setFetchError(t("gitSetup.errors.needServerUrl"));
    }
    setFetchError("");
    setFetching(true);
    try {
      const repos = await fetchRemoteRepos({
        provider,
        serverUrl,
        username: username.trim(),
        token: token.trim(),
      });
      setRemoteRepos(repos);
      setSelected(new Set(repos.map((r) => r.full_name)));
    } catch (err) {
      setFetchError(errorMessage(err));
      setRemoteRepos(null);
    } finally {
      setFetching(false);
    }
  }

  function toggleRepo(fullName: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(fullName);
      else next.delete(fullName);
      return next;
    });
  }

  async function submit() {
    if (!label.trim()) return setError(t("gitSetup.errors.needName"));
    if (!remoteRepos || remoteRepos.length === 0) {
      return setError(t("gitSetup.errors.needFetch"));
    }
    if (selected.size === 0) return setError(t("gitSetup.errors.needSelection"));
    if (!destination) return setError(t("gitSetup.errors.needDestination"));

    setError("");
    setBusy(true);
    try {
      const allSelected = selected.size === remoteRepos.length;
      const target = await createGitTarget({
        label: label.trim(),
        provider,
        serverUrl,
        username: username.trim(),
        token: token.trim(),
        destPath: destination,
        selectedRepos: allSelected ? [] : Array.from(selected),
      });
      onDone(target);
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
        <ArrowLeft className="size-4" /> {t("common.back")}
      </button>

      <h2 className="text-2xl font-semibold">{t("gitSetup.title")}</h2>

      {gitReady === false && (
        <Alert variant="destructive" data-testid="git-missing">
          <AlertDescription className="flex flex-col gap-2">
            <p>{t("gitSetup.gitMissing")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={runInstallGit}
              disabled={installing}
              data-testid="btn-install-git"
              className="w-fit gap-2"
            >
              {installing
                ? <Loader2 className="size-4 animate-spin" />
                : <Download className="size-4" />}
              {t("gitSetup.installGitButton")}
            </Button>
            {installError && (
              <p className="text-destructive text-xs">{installError}</p>
            )}
            {installLog.length > 0 && (
              <div
                ref={logRef}
                className="bg-muted max-h-32 overflow-y-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap"
              >
                {installLog.join("\n")}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="git-setup-label">{t("common.name")}</Label>
        <Input
          id="git-setup-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("gitSetup.namePlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("gitSetup.providerLabel")}</Label>
        <Select value={provider} onValueChange={(v) => changeProvider(v as GitProvider)}>
          <SelectTrigger data-testid="git-provider-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="github">GitHub</SelectItem>
            <SelectItem value="gitlab">GitLab</SelectItem>
            <SelectItem value="forgejo">Forgejo / Gitea</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="git-setup-server">{t("gitSetup.serverLabel")}</Label>
        <Input
          id="git-setup-server"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder={provider === "forgejo" ? "https://git.example.com" : ""}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="git-setup-username">{t("gitSetup.usernameLabel")}</Label>
        <Input
          id="git-setup-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("gitSetup.usernamePlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="git-setup-token">{t("gitSetup.tokenLabel")}</Label>
        <Input
          id="git-setup-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("gitSetup.tokenPlaceholder")}
        />
        <p className="text-muted-foreground text-xs">{t("gitSetup.tokenHint")}</p>
      </div>

      <Button
        variant="outline"
        onClick={doFetchRepos}
        disabled={fetching || gitReady === false}
        data-testid="btn-fetch-repos"
        className="w-fit gap-2"
      >
        {fetching && <Loader2 className="size-4 animate-spin" />}
        <FolderGit2 className="size-4" />
        {t("gitSetup.fetchButton")}
      </Button>
      {fetchError && <p className="text-destructive text-sm">{fetchError}</p>}

      {remoteRepos && (
        <div className="border-border rounded-md border">
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">
              {t("gitSetup.repoCount", { count: remoteRepos.length })}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("gitSetup.selectionCount", { count: selected.size })}
            </span>
          </div>
          <ScrollArea className="h-56">
            <ul className="p-2">
              {remoteRepos.map((repo) => (
                <li
                  key={repo.full_name}
                  data-testid="remote-repo-item"
                  className="hover:bg-accent flex items-center gap-2 rounded-sm px-2 py-1.5"
                >
                  <Checkbox
                    checked={selected.has(repo.full_name)}
                    onCheckedChange={(c) => toggleRepo(repo.full_name, c === true)}
                  />
                  <span className="truncate text-sm">{repo.full_name}</span>
                  {repo.private && (
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                      {t("gitSetup.privateLabel")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>{t("gitSetup.destinationLabel")}</Label>
        <p className="text-muted-foreground text-sm break-all">
          {destination ?? t("common.noFolderChosen")}
        </p>
        <Button
          variant="outline"
          onClick={chooseDestination}
          data-testid="btn-git-destination"
          className="w-fit gap-2"
        >
          <HardDrive className="size-4" />
          {t("common.chooseFolder")}
        </Button>
      </div>

      {error && (
        <p data-testid="git-setup-error" className="text-destructive text-sm">
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
          data-testid="btn-git-setup-submit"
          className="gap-2"
        >
          {busy
            ? <Loader2 className="size-4 animate-spin" />
            : <Check className="size-4" />}
          {t("gitSetup.createButton")}
        </Button>
      </div>
    </div>
  );
}
