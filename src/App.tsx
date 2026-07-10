import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import HomeView from "@/components/views/HomeView";
import SetupView from "@/components/views/SetupView";
import RepoView from "@/components/views/RepoView";
import RestoreView from "@/components/views/RestoreView";
import ReplicateView from "@/components/views/ReplicateView";
import GitSetupView from "@/components/views/GitSetupView";
import GitTargetView from "@/components/views/GitTargetView";
import GitRestoreView from "@/components/views/GitRestoreView";
import ImportView from "@/components/views/ImportView";
import {
  checkPathExists,
  detectRestic,
  type GitTarget,
  listGitTargets,
  listRepos,
  pickFolder,
  relinkGitTarget,
  relinkRepo,
  type Replica,
  type Repo,
} from "@/lib/api";

type View =
  | "home"
  | "setup"
  | "repo"
  | "restore"
  | "replicate"
  | "git-setup"
  | "git-target"
  | "git-restore"
  | "import";

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [gitTargets, setGitTargets] = useState<GitTarget[]>([]);
  const [missingRepoIds, setMissingRepoIds] = useState<Set<string>>(new Set());
  const [missingGitTargetIds, setMissingGitTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [currentRepoId, setCurrentRepoId] = useState<string | null>(null);
  const [currentGitTargetId, setCurrentGitTargetId] = useState<string | null>(
    null,
  );
  const [view, setView] = useState<View>("home");
  const [resticMissing, setResticMissing] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await detectRestic();
      } catch {
        setResticMissing(true);
      }
      try {
        const loaded = await listRepos();
        setRepos(loaded);
        const missing = await Promise.all(
          loaded.map(async (r) => ({
            id: r.id,
            exists: await checkPathExists(r.repo_path).catch(() => true),
          })),
        );
        setMissingRepoIds(
          new Set(missing.filter((m) => !m.exists).map((m) => m.id)),
        );
      } catch {
        /* ignore — surfaced elsewhere */
      }
      try {
        const loaded = await listGitTargets();
        setGitTargets(loaded);
        const missing = await Promise.all(
          loaded.map(async (t) => ({
            id: t.id,
            exists: await checkPathExists(t.dest_path).catch(() => true),
          })),
        );
        setMissingGitTargetIds(
          new Set(missing.filter((m) => !m.exists).map((m) => m.id)),
        );
      } catch {
        /* ignore — surfaced elsewhere */
      }
    })();
  }, []);

  const currentRepo = repos.find((r) => r.id === currentRepoId) ?? null;
  const currentGitTarget =
    gitTargets.find((t) => t.id === currentGitTargetId) ?? null;

  const openRepo = useCallback((id: string) => {
    setCurrentRepoId(id);
    setView("repo");
  }, []);

  const openGitTarget = useCallback((id: string) => {
    setCurrentGitTargetId(id);
    setView("git-target");
  }, []);

  const handleCreated = useCallback((repo: Repo) => {
    setRepos((prev) => [...prev, repo]);
    setCurrentRepoId(repo.id);
    setView("repo");
  }, []);

  const handleUpdated = useCallback((repo: Repo) => {
    setRepos((prev) => prev.map((r) => (r.id === repo.id ? repo : r)));
    setEditing(false);
    setView("repo");
  }, []);

  const handleImported = useCallback((repo: Repo) => {
    setRepos((prev) => [...prev, repo]);
    setCurrentRepoId(repo.id);
    setView("repo");
  }, []);

  const handleGitTargetCreated = useCallback((target: GitTarget) => {
    setGitTargets((prev) => [...prev, target]);
    setCurrentGitTargetId(target.id);
    setView("git-target");
  }, []);

  const handleRepoRemoved = useCallback((repoId: string) => {
    setRepos((prev) => prev.filter((r) => r.id !== repoId));
    setMissingRepoIds((prev) => {
      const next = new Set(prev);
      next.delete(repoId);
      return next;
    });
    setCurrentRepoId(null);
    setView("home");
  }, []);

  const handleGitTargetRemoved = useCallback((targetId: string) => {
    setGitTargets((prev) => prev.filter((t) => t.id !== targetId));
    setMissingGitTargetIds((prev) => {
      const next = new Set(prev);
      next.delete(targetId);
      return next;
    });
    setCurrentGitTargetId(null);
    setView("home");
  }, []);

  const handleReplicaAdded = useCallback(
    (repoId: string, replica: Replica) => {
      setRepos((prev) =>
        prev.map((r) =>
          r.id === repoId ? { ...r, replicas: [...r.replicas, replica] } : r
        )
      );
    },
    [],
  );

  const locateRepo = useCallback(async (repoId: string) => {
    const folder = await pickFolder();
    if (!folder) return;
    try {
      const repo = await relinkRepo({ repoId, newRepoPath: folder });
      setRepos((prev) => prev.map((r) => (r.id === repo.id ? repo : r)));
      setMissingRepoIds((prev) => {
        const next = new Set(prev);
        next.delete(repoId);
        return next;
      });
    } catch {
      /* the chosen folder isn't this backup — leave it marked as missing */
    }
  }, []);

  const locateGitTarget = useCallback(async (targetId: string) => {
    const folder = await pickFolder();
    if (!folder) return;
    try {
      const target = await relinkGitTarget({
        targetId,
        newDestPath: folder,
      });
      setGitTargets((prev) =>
        prev.map((t) => (t.id === target.id ? target : t))
      );
      setMissingGitTargetIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    } catch {
      /* invalid folder — leave it marked as missing */
    }
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col">
      <Header />
      <main className="flex-1 p-6">
        {view === "home" && (
          <HomeView
            repos={repos}
            gitTargets={gitTargets}
            missingRepoIds={missingRepoIds}
            missingGitTargetIds={missingGitTargetIds}
            resticMissing={resticMissing}
            onOpenRepo={openRepo}
            onOpenGitTarget={openGitTarget}
            onLocateRepo={locateRepo}
            onLocateGitTarget={locateGitTarget}
            onNewBackup={() => {
              setEditing(false);
              setView("setup");
            }}
            onNewGitBackup={() => setView("git-setup")}
            onImportBackup={() => setView("import")}
          />
        )}
        {view === "setup" && (
          <SetupView
            editRepo={editing ? currentRepo : null}
            onCancel={() => setView(editing ? "repo" : "home")}
            onDone={editing ? handleUpdated : handleCreated}
          />
        )}
        {view === "import" && (
          <ImportView onCancel={() => setView("home")} onDone={handleImported} />
        )}
        {view === "repo" && currentRepo && (
          <RepoView
            repo={currentRepo}
            onBack={() => setView("home")}
            onGoRestore={() => setView("restore")}
            onGoReplicate={() => setView("replicate")}
            onEdit={() => {
              setEditing(true);
              setView("setup");
            }}
            onRemoved={handleRepoRemoved}
          />
        )}
        {view === "restore" && currentRepo && (
          <RestoreView
            repo={currentRepo}
            onBack={() => setView("repo")}
          />
        )}
        {view === "replicate" && currentRepo && (
          <ReplicateView
            repo={currentRepo}
            onBack={() => setView("repo")}
            onReplicaAdded={handleReplicaAdded}
          />
        )}
        {view === "git-setup" && (
          <GitSetupView
            onCancel={() => setView("home")}
            onDone={handleGitTargetCreated}
          />
        )}
        {view === "git-target" && currentGitTarget && (
          <GitTargetView
            target={currentGitTarget}
            onBack={() => setView("home")}
            onGoRestore={() => setView("git-restore")}
            onRemoved={handleGitTargetRemoved}
          />
        )}
        {view === "git-restore" && currentGitTarget && (
          <GitRestoreView
            target={currentGitTarget}
            onBack={() => setView("git-target")}
          />
        )}
      </main>
    </div>
  );
}
