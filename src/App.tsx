import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import HomeView from "@/components/views/HomeView";
import SetupView from "@/components/views/SetupView";
import RepoView from "@/components/views/RepoView";
import RestoreView from "@/components/views/RestoreView";
import ReplicateView from "@/components/views/ReplicateView";
import { detectRestic, listRepos, type Replica, type Repo } from "@/lib/api";

type View = "home" | "setup" | "repo" | "restore" | "replicate";

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [currentRepoId, setCurrentRepoId] = useState<string | null>(null);
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
        setRepos(await listRepos());
      } catch {
        /* ignore — surfaced elsewhere */
      }
    })();
  }, []);

  const currentRepo = repos.find((r) => r.id === currentRepoId) ?? null;

  const openRepo = useCallback((id: string) => {
    setCurrentRepoId(id);
    setView("repo");
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col">
      <Header />
      <main className="flex-1 p-6">
        {view === "home" && (
          <HomeView
            repos={repos}
            resticMissing={resticMissing}
            onOpenRepo={openRepo}
            onNewBackup={() => {
              setEditing(false);
              setView("setup");
            }}
          />
        )}
        {view === "setup" && (
          <SetupView
            editRepo={editing ? currentRepo : null}
            onCancel={() => setView(editing ? "repo" : "home")}
            onDone={editing ? handleUpdated : handleCreated}
          />
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
      </main>
    </div>
  );
}
