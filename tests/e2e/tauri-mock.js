// Mocks the Tauri v2 IPC layer used by @tauri-apps/api (core + event) and
// @tauri-apps/plugin-dialog, which all route through `window.__TAURI_INTERNALS__`.
export async function installTauriMock(page, initialState = {}) {
  await page.addInitScript((seed) => {
    const state = {
      repos: [],
      resticAvailable: true,
      nextFolderPick: null,
      backupShouldFail: null,
      restoreShouldFail: null,
      replicateShouldFail: null,
      ...seed,
    };
    window.__mockState__ = state;
    state.lastArgs = {};

    // --- event plumbing -----------------------------------------------------
    const callbacks = {};
    let cbCounter = 0;
    let eventCounter = 0;
    const subscriptions = {}; // eventId -> { event, cbId }

    window.__emit__ = (name, payload) => {
      Object.values(subscriptions)
        .filter((s) => s.event === name)
        .forEach((s) => {
          const cb = callbacks[s.cbId];
          if (cb) cb({ event: name, id: s.cbId, payload });
        });
    };

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function rawInvoke(cmd, args) {
      switch (cmd) {
        // --- event plugin ---------------------------------------------------
        case "plugin:event|listen": {
          const eventId = ++eventCounter;
          subscriptions[eventId] = { event: args.event, cbId: args.handler };
          return eventId;
        }
        case "plugin:event|unlisten": {
          delete subscriptions[args.eventId];
          return null;
        }

        // --- dialog plugin --------------------------------------------------
        case "plugin:dialog|open":
          return state.nextFolderPick;

        // --- app commands ---------------------------------------------------
        case "detect_restic":
          if (!state.resticAvailable) throw { kind: "restic_not_found" };
          return "restic 0.19.0";

        case "list_repos":
          return state.repos;

        case "create_repo": {
          const repo = {
            id: `repo-${state.repos.length + 1}`,
            label: args.label,
            repo_path: args.repoPath,
            source_paths: args.sourcePaths,
            replicas: [],
            created_at: "0",
          };
          state.repos.push(repo);
          return repo;
        }

        case "update_repo": {
          const repo = state.repos.find((r) => r.id === args.repoId);
          repo.label = args.label;
          repo.source_paths = args.sourcePaths;
          return repo;
        }

        case "run_backup": {
          window.__emit__("backup-event", {
            message_type: "status",
            percent_done: 0.5,
            total_files: 2,
            files_done: 1,
            total_bytes: 100,
            bytes_done: 50,
          });
          await wait(150);
          if (state.backupShouldFail) throw state.backupShouldFail;
          return {
            message_type: "summary",
            files_new: 2,
            files_changed: 0,
            files_unmodified: 0,
            data_added: 100,
            total_files_processed: 2,
            total_bytes_processed: 10,
            snapshot_id: "snap-1",
          };
        }

        case "list_snapshots": {
          const repo = state.repos.find((r) => r.id === args.repoId);
          return (repo && repo.snapshots) || [];
        }

        case "list_snapshot_files": {
          const repo = state.repos.find((r) => r.id === args.repoId);
          const files = (repo && repo.files) || {};
          return files[args.path] || [];
        }

        case "restore_snapshot": {
          window.__emit__("restore-log", "restoring snapshot...");
          if (state.restoreShouldFail) throw state.restoreShouldFail;
          return null;
        }

        case "add_replica": {
          const repo = state.repos.find((r) => r.id === args.repoId);
          const replica = {
            id: `replica-${repo.replicas.length + 1}`,
            label: args.label,
            repo_path: args.repoPath,
          };
          repo.replicas.push(replica);
          return replica;
        }

        case "run_replicate": {
          window.__emit__("replicate-log", "copying snapshots...");
          if (state.replicateShouldFail) throw state.replicateShouldFail;
          return null;
        }

        default:
          throw new Error(`unmocked command: ${cmd}`);
      }
    }

    async function mockInvoke(cmd, args = {}) {
      state.lastArgs[cmd] = structuredClone(args);
      const result = await rawInvoke(cmd, args);
      return structuredClone(result);
    }

    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => mockInvoke(cmd, args),
      transformCallback: (callback) => {
        const id = ++cbCounter;
        callbacks[id] = callback;
        return id;
      },
      // Some builds probe for a metadata object; provide a harmless stub.
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    };

    // withGlobalTauri compatibility shim (not used by the npm API, but cheap).
    window.__TAURI__ = { core: { invoke: mockInvoke } };
  }, initialState);
}

export async function setNextFolderPick(page, path) {
  await page.evaluate((p) => {
    window.__mockState__.nextFolderPick = p;
  }, path);
}

export async function setBackupShouldFail(page, error) {
  await page.evaluate((err) => {
    window.__mockState__.backupShouldFail = err;
  }, error);
}

export function repoWithSnapshot(snapshot, files = {}) {
  return {
    id: "repo-1",
    label: "Seeded Repo",
    repo_path: "/tmp/seeded-repo",
    source_paths: ["/tmp/seeded-source"],
    replicas: [],
    created_at: "0",
    snapshots: [snapshot],
    files,
  };
}
