import { expect, test } from "@playwright/test";
import {
  installTauriMock,
  repoWithSnapshot,
  setBackupShouldFail,
  setNextFolderPick,
} from "./tauri-mock.js";

async function start(page, initialState = {}) {
  await installTauriMock(page, initialState);
  await page.goto("/");
  await expect(page.getByTestId("btn-new-backup")).toBeVisible();
}

async function createRepo(page, { label = "My Laptop" } = {}) {
  await page.getByTestId("btn-new-backup").click();
  await page.fill("#setup-label", label);
  await setNextFolderPick(page, "/tmp/source");
  await page.getByTestId("btn-add-source").click();
  await setNextFolderPick(page, "/tmp/dest");
  await page.getByTestId("btn-choose-destination").click();
  await page.fill("#setup-password", "hunter2");
  await page.fill("#setup-confirm", "hunter2");
  await page.getByTestId("btn-setup-submit").click();
  await expect(page.getByTestId("repo-title")).toBeVisible();
}

test("setup flow validates each field before allowing creation", async ({ page }) => {
  await start(page);
  await page.getByTestId("btn-new-backup").click();
  await expect(page.locator("#setup-label")).toBeVisible();

  await page.getByTestId("btn-setup-submit").click();
  await expect(page.getByTestId("setup-error")).toHaveText(
    "Give this backup a name.",
  );

  await page.fill("#setup-label", "My Laptop");
  await page.getByTestId("btn-setup-submit").click();
  await expect(page.getByTestId("setup-error")).toHaveText(
    "Add at least one folder to back up.",
  );

  await setNextFolderPick(page, "/tmp/source");
  await page.getByTestId("btn-add-source").click();
  await expect(page.getByTestId("setup-source")).toHaveCount(1);

  await page.getByTestId("btn-setup-submit").click();
  await expect(page.getByTestId("setup-error")).toHaveText(
    "Choose a backup destination.",
  );

  await setNextFolderPick(page, "/tmp/dest");
  await page.getByTestId("btn-choose-destination").click();

  await page.fill("#setup-password", "hunter2");
  await page.fill("#setup-confirm", "different");
  await page.getByTestId("btn-setup-submit").click();
  await expect(page.getByTestId("setup-error")).toHaveText(
    "Passwords don't match.",
  );

  await page.fill("#setup-confirm", "hunter2");
  await page.getByTestId("btn-setup-submit").click();

  await expect(page.getByTestId("repo-title")).toHaveText("My Laptop");
});

test("setup flow allows creating an unencrypted backup with no password", async ({ page }) => {
  await start(page);
  await page.getByTestId("btn-new-backup").click();
  await page.fill("#setup-label", "No Password Backup");
  await setNextFolderPick(page, "/tmp/source");
  await page.getByTestId("btn-add-source").click();
  await setNextFolderPick(page, "/tmp/dest");
  await page.getByTestId("btn-choose-destination").click();

  await page.getByTestId("btn-setup-submit").click();

  await expect(page.getByTestId("repo-title")).toHaveText("No Password Backup");
});

test("backup flow shows progress then a success summary", async ({ page }) => {
  await start(page);
  await createRepo(page);

  await page.getByTestId("btn-backup-now").click();
  await expect(page.getByTestId("backup-progress-text")).toHaveText(
    "50% — 1/2 files",
  );
  await expect(page.getByTestId("backup-result")).toHaveText(
    "Backed up 2 files, 2 new, 0 changed.",
  );
});

test("backup flow surfaces a translated error on failure", async ({ page }) => {
  await start(page);
  await createRepo(page);
  await setBackupShouldFail(page, { kind: "wrong_password" });

  await page.getByTestId("btn-backup-now").click();
  await expect(page.getByTestId("backup-result")).toHaveText(
    "Backup failed: That password is incorrect for this backup.",
  );
});

test("edit flow updates the backup name and folders", async ({ page }) => {
  await start(page);
  await createRepo(page, { label: "Original Name" });

  await page.getByTestId("btn-edit-repo").click();
  await expect(page.locator("#setup-label")).toHaveValue("Original Name");

  await page.fill("#setup-label", "Renamed Backup");
  await setNextFolderPick(page, "/tmp/extra-folder");
  await page.getByTestId("btn-add-source").click();
  await expect(page.getByTestId("setup-source")).toHaveCount(2);

  await page.getByTestId("btn-setup-submit").click();

  await expect(page.getByTestId("repo-title")).toHaveText("Renamed Backup");

  const updateArgs = await page.evaluate(
    () => window.__mockState__.lastArgs.update_repo,
  );
  expect(updateArgs.label).toBe("Renamed Backup");
  expect(updateArgs.sourcePaths).toEqual(["/tmp/source", "/tmp/extra-folder"]);
});

test("restore flow lists snapshots and restores the selected one", async ({ page }) => {
  await start(page, {
    repos: [
      repoWithSnapshot({
        id: "snap-full-id",
        short_id: "abc1234",
        time: "2026-01-15T10:30:00Z",
        hostname: "host",
        paths: ["/tmp/seeded-source"],
        tags: [],
      }),
    ],
  });

  await page.getByTestId("repo-card").click();
  await expect(page.getByTestId("repo-title")).toBeVisible();

  await page.getByTestId("btn-go-restore").click();
  await expect(page.getByTestId("snapshot-item")).toContainText("abc1234");

  await expect(page.getByTestId("btn-restore-run")).toBeDisabled();
  await page.getByTestId("snapshot-item").click();
  await expect(page.getByTestId("btn-restore-run")).toBeDisabled();

  await setNextFolderPick(page, "/tmp/restore-here");
  await page.getByTestId("btn-restore-destination").click();
  await expect(page.getByTestId("btn-restore-run")).toBeEnabled();

  await page.getByTestId("btn-restore-run").click();
  await expect(page.getByTestId("restore-log")).toContainText(
    "Restore complete.",
  );
});

test("restore flow lets you browse a snapshot and restore only specific files", async ({ page }) => {
  const files = {
    "/tmp/seeded-source": [
      { name: "Documents", type: "dir", path: "/tmp/seeded-source/Documents" },
      {
        name: "notes.txt",
        type: "file",
        path: "/tmp/seeded-source/notes.txt",
        size: 10,
      },
    ],
    "/tmp/seeded-source/Documents": [
      {
        name: "report.txt",
        type: "file",
        path: "/tmp/seeded-source/Documents/report.txt",
        size: 5,
      },
    ],
  };

  await start(page, {
    repos: [
      repoWithSnapshot(
        {
          id: "snap-full-id",
          short_id: "abc1234",
          time: "2026-01-15T10:30:00Z",
          hostname: "host",
          paths: ["/tmp/seeded-source"],
          tags: [],
        },
        files,
      ),
    ],
  });

  await page.getByTestId("repo-card").click();
  await page.getByTestId("btn-go-restore").click();
  await expect(page.getByTestId("btn-toggle-file-picker")).toBeDisabled();

  await page.getByTestId("snapshot-item").click();
  await expect(page.getByTestId("btn-toggle-file-picker")).toBeEnabled();

  await page.getByTestId("btn-toggle-file-picker").click();
  await expect(page.getByTestId("btn-toggle-file-picker")).toHaveText(
    "Restore Everything Instead",
  );

  const rootNode = page.locator('[data-path="/tmp/seeded-source"]');
  await expect(rootNode.getByTestId("tree-name").first()).toHaveText(
    "seeded-source",
  );
  await rootNode.locator('> div [data-testid="tree-toggle"]').click();
  await expect(
    page.locator('[data-path="/tmp/seeded-source/Documents"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-path="/tmp/seeded-source/notes.txt"]'),
  ).toBeVisible();

  await page
    .locator(
      '[data-path="/tmp/seeded-source/Documents"] > div [data-testid="tree-toggle"]',
    )
    .click();
  const reportNode = page.locator(
    '[data-path="/tmp/seeded-source/Documents/report.txt"]',
  );
  await expect(reportNode).toBeVisible();
  await reportNode.locator('> div [data-testid="tree-checkbox"]').click();

  await expect(page.getByTestId("restore-selection-count")).toHaveText(
    "1 item(s) selected — everything else will be left out.",
  );

  await setNextFolderPick(page, "/tmp/restore-here");
  await page.getByTestId("btn-restore-destination").click();
  await page.getByTestId("btn-restore-run").click();
  await expect(page.getByTestId("restore-log")).toContainText(
    "Restore complete.",
  );

  const restoreArgs = await page.evaluate(
    () => window.__mockState__.lastArgs.restore_snapshot,
  );
  expect(restoreArgs.include).toEqual([
    "/tmp/seeded-source/Documents/report.txt",
  ]);
});

test("replicate flow adds a target and replicates to it", async ({ page }) => {
  await start(page);
  await createRepo(page);
  await page.getByTestId("btn-go-replicate").click();
  await expect(page.getByTestId("no-replicas")).toContainText(
    "No replication targets yet.",
  );

  await page.getByTestId("btn-add-replica").click();
  await page.fill("#replica-label", "NAS");
  await setNextFolderPick(page, "/tmp/replica");
  await page.getByTestId("btn-replica-choose").click();
  await page.fill("#replica-password", "replica-pass");
  await page.getByTestId("btn-replica-create").click();

  await expect(page.getByTestId("replica-card")).toContainText("NAS");

  await page.getByTestId("btn-replicate-now").click();
  await expect(page.getByTestId("replicate-log")).toContainText(
    "Replication complete.",
  );
});

test("language switch translates static and dynamic text", async ({ page }) => {
  await start(page);
  await createRepo(page, { label: "Mon PC" });
  await page.getByTestId("btn-back").click();

  await expect(page.getByTestId("btn-new-backup")).toHaveText(
    "Set Up a Backup",
  );

  await page.getByTestId("language-select").click();
  await page.getByRole("option", { name: "FR" }).click();

  await expect(page.getByTestId("btn-new-backup")).toHaveText(
    "Configurer une sauvegarde",
  );
  await expect(page.getByTestId("repo-card-sub")).toContainText("dossier(s)");
});

test("shows an install banner when restic is missing", async ({ page }) => {
  await start(page, { resticAvailable: false });
  await expect(page.getByTestId("restic-missing")).toBeVisible();
});
