import { AlertCircle, ChevronRight, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import type { Repo } from "@/lib/api";

interface Props {
  repos: Repo[];
  resticMissing: boolean;
  onOpenRepo: (id: string) => void;
  onNewBackup: () => void;
}

export default function HomeView({
  repos,
  resticMissing,
  onOpenRepo,
  onNewBackup,
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
        {repos.map((repo) => (
          <Card
            key={repo.id}
            data-testid="repo-card"
            onClick={() => onOpenRepo(repo.id)}
            className="hover:border-ring cursor-pointer flex-row items-center justify-between gap-4 py-4 transition-colors"
          >
            <div className="min-w-0 px-6">
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
            <ChevronRight className="text-muted-foreground mr-6 size-5 shrink-0" />
          </Card>
        ))}
      </div>

      <Button
        onClick={onNewBackup}
        data-testid="btn-new-backup"
        className="gap-2 self-start"
      >
        <Plus className="size-4" />
        {t("home.setupButton")}
      </Button>
    </div>
  );
}
