import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Download,
  FolderGit2,
  HardDrive,
  Plus,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import type { GitTarget, Repo } from "@/lib/api";

interface Props {
  repos: Repo[];
  gitTargets: GitTarget[];
  missingRepoIds: Set<string>;
  missingGitTargetIds: Set<string>;
  resticMissing: boolean;
  onOpenRepo: (id: string) => void;
  onOpenGitTarget: (id: string) => void;
  onLocateRepo: (id: string) => void;
  onLocateGitTarget: (id: string) => void;
  onNewBackup: () => void;
  onNewGitBackup: () => void;
  onImportBackup: () => void;
}

export default function HomeView({
  repos,
  gitTargets,
  missingRepoIds,
  missingGitTargetIds,
  resticMissing,
  onOpenRepo,
  onOpenGitTarget,
  onLocateRepo,
  onLocateGitTarget,
  onNewBackup,
  onNewGitBackup,
  onImportBackup,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-6">
      {resticMissing && (
        <Alert variant="destructive" data-testid="restic-missing">
          <AlertCircle />
          <AlertDescription>
            <p>{t("home.resticMissingLine1")}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {t("home.resticMissingOs.macos")}{" "}
              <code className="bg-muted rounded px-1">brew install restic</code>
              {" "}
              · {t("home.resticMissingOs.linux")}{" "}
              <code className="bg-muted rounded px-1">apt install restic</code>
              {" "}
              · {t("home.resticMissingOs.windows")}{" "}
              <code className="bg-muted rounded px-1">
                winget install restic.restic
              </code>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        {repos.map((repo) => {
          const missing = missingRepoIds.has(repo.id);
          return (
            <Card
              key={repo.id}
              data-testid="repo-card"
              className="gap-2 py-4"
            >
              <div
                onClick={() => !missing && onOpenRepo(repo.id)}
                className={`flex items-center justify-between gap-4 px-6 ${
                  missing ? "" : "cursor-pointer"
                }`}
              >
                <HardDrive className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1 px-2">
                  <div className="truncate font-medium">{repo.label}</div>
                  <div
                    data-testid="repo-card-sub"
                    className="text-muted-foreground truncate text-sm"
                  >
                    {t("home.repoCardSummary", {
                      count: repo.source_paths.length,
                      path: repo.repo_path,
                    })}
                  </div>
                </div>
                {!missing && (
                  <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                )}
              </div>
              {missing && (
                <div
                  data-testid="repo-missing-banner"
                  className="text-muted-foreground flex flex-wrap items-center gap-2 px-6 text-xs"
                >
                  <AlertTriangle className="text-destructive size-3.5 shrink-0" />
                  {t("home.locationMissing")}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onLocateRepo(repo.id)}
                    data-testid="btn-locate-repo"
                    className="h-7"
                  >
                    {t("home.locateButton")}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
        {gitTargets.map((target) => {
          const missing = missingGitTargetIds.has(target.id);
          return (
            <Card
              key={target.id}
              data-testid="git-target-card"
              className="gap-2 py-4"
            >
              <div
                onClick={() => !missing && onOpenGitTarget(target.id)}
                className={`flex items-center justify-between gap-4 px-6 ${
                  missing ? "" : "cursor-pointer"
                }`}
              >
                <FolderGit2 className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1 px-2">
                  <div className="truncate font-medium">{target.label}</div>
                  <div
                    data-testid="git-target-card-sub"
                    className="text-muted-foreground truncate text-sm"
                  >
                    {t("home.gitTargetCardSummary", {
                      provider: t(`gitSetup.providers.${target.provider}`),
                      path: target.dest_path,
                    })}
                  </div>
                </div>
                {!missing && (
                  <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                )}
              </div>
              {missing && (
                <div
                  data-testid="git-target-missing-banner"
                  className="text-muted-foreground flex flex-wrap items-center gap-2 px-6 text-xs"
                >
                  <AlertTriangle className="text-destructive size-3.5 shrink-0" />
                  {t("home.locationMissing")}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onLocateGitTarget(target.id)}
                    data-testid="btn-locate-git-target"
                    className="h-7"
                  >
                    {t("home.locateButton")}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={onNewBackup}
          data-testid="btn-new-backup"
          className="gap-2"
        >
          <Plus className="size-4" />
          {t("home.setupButton")}
        </Button>
        <Button
          onClick={onNewGitBackup}
          variant="outline"
          data-testid="btn-new-git-backup"
          className="gap-2"
        >
          <FolderGit2 className="size-4" />
          {t("home.setupGitButton")}
        </Button>
        <Button
          onClick={onImportBackup}
          variant="outline"
          data-testid="btn-import-backup"
          className="gap-2"
        >
          <Download className="size-4" />
          {t("home.importButton")}
        </Button>
      </div>
    </div>
  );
}
