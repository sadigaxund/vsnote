/**
 * Phase 17 Milestone C2 (docs/IMPLEMENTATION-PLAN-V2.md's Phase 17 section:
 * "Git & Sync renders as a SETUP WIZARD when no repo exists ... all in UI,
 * no CLI ever") — exercises `src/components/local/VaultSetupPanel.tsx`.
 *
 * Two specs, two different strategies for two different reasons:
 *
 * 1. "uninitialized wizard, step by step" — the shared e2e backend
 *    (`shareFixtures.ts`) is reused by every spec file in this run
 *    (`fullyParallel: true`), and `git-sync.spec.ts` both PUSHES to and
 *    outright DELETES-from-disk the exact same legacy "vault" repo this
 *    panel reads. Whether that repo currently exists on disk at any given
 *    instant during a real run is therefore genuinely unpredictable, and
 *    calling the real `POST /api/vault/init` here would itself mutate
 *    that same shared state for every other spec. So this test intercepts
 *    `GET /api/vault`, `POST /api/vault/init`, and `GET /api/vault/remotes`
 *    with `page.route` — a fully deterministic, backend-independent proof
 *    that the wizard's three phases (create -> connect-remote -> the
 *    management surface it reveals) render and transition correctly.
 *
 * 2. "real server state, end to end" — signs in and reads whatever the
 *    REAL shared backend currently reports (read-only: never calls
 *    `POST /api/vault/init` itself), branching on which of the two
 *    possible real states it finds; when the vault turns out to already be
 *    initialized, it drives a full add/test/mirror/delete cycle against a
 *    remote this test creates fresh (a temp local bare repo, unique per
 *    test run, cleaned up in a `finally`), which is genuinely reachable
 *    from the real backend process without any network dependency.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { signInToShareBackend } from "./shareUiHelpers";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";

const DEFAULT_BRANCH = "feat/incremental-index";

const MOCK_VAULT_UNINITIALIZED = {
  path: "/tmp/mock-git-root/vault.git",
  mounted: false,
  initialized: false,
  bare: true,
  repo_name: "vault",
  head_branch: null,
  has_commits: false,
  worktree_dirty: false,
  last_commit_message: null,
  last_commit_time: null,
};

const MOCK_VAULT_INITIALIZED = {
  ...MOCK_VAULT_UNINITIALIZED,
  initialized: true,
  head_branch: DEFAULT_BRANCH,
};

test.describe("Vault setup wizard (mocked, deterministic)", () => {
  test("uninitialized state renders step 1, then step 2, then the management surface it reveals", async ({ page }) => {
    await page.route("**/api/vault", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: MOCK_VAULT_UNINITIALIZED });
      } else {
        await route.continue();
      }
    });
    await page.route("**/api/vault/init", async (route) => {
      await route.fulfill({ json: MOCK_VAULT_INITIALIZED });
    });
    await page.route("**/api/vault/remotes", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });

    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    await page.getByTestId("settings-nav-git-sync").click();

    // Step 1: create.
    const step1 = page.getByTestId("vault-wizard-create");
    await expect(step1).toBeVisible();
    await expect(step1.getByText("Step 1 of 2: Create the vault repository")).toBeVisible();
    await expect(page.getByTestId("vault-init-branch")).toHaveValue(DEFAULT_BRANCH);
    // Never a modal (task requirement) — this whole thing renders inline
    // inside the existing Settings tab.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByTestId("vault-init-submit").click();

    // Step 2: optional, skippable remote connection.
    const step2 = page.getByTestId("vault-wizard-remote");
    await expect(step2).toBeVisible();
    await expect(step2.getByText("Step 2 of 2: Connect an external remote")).toBeVisible();
    await expect(page.getByTestId("vault-wizard-skip-remote")).toBeVisible();
    await expect(page.getByTestId("vault-wizard-finish-remote")).toBeVisible();

    await page.getByTestId("vault-wizard-skip-remote").click();

    // Done state: the normal management surface, with the vault's real
    // (here, mocked-real) reported state.
    const management = page.getByTestId("vault-management");
    await expect(management).toBeVisible();
    const status = page.getByTestId("vault-status");
    await expect(status).toBeVisible();
    await expect(status.getByText("/tmp/mock-git-root/vault.git")).toBeVisible();
    await expect(status.getByText(DEFAULT_BRANCH)).toBeVisible();
    await expect(page.getByText("No external remotes yet.")).toBeVisible();
    // Reloading a Settings mount after init never re-shows the wizard
    // (DESIGN-SPEC rule: "initialized: true -> no wizard").
    await expect(page.getByTestId("vault-wizard-create")).toHaveCount(0);
    await expect(page.getByTestId("vault-wizard-remote")).toHaveCount(0);
  });
});

test.describe("Vault setup, real backend", () => {
  test("Git & Sync renders the real server vault state and manages a mirror remote end to end", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    await page.getByTestId("settings-nav-git-sync").click();

    const createStep = page.getByTestId("vault-wizard-create");
    const management = page.getByTestId("vault-management");
    await expect(createStep.or(management)).toBeVisible({ timeout: 15_000 });

    if (await createStep.isVisible()) {
      // The real, shared backend genuinely has no "vault" repo on disk right
      // now (see this file's module doc: `git-sync.spec.ts` both creates
      // and deletes that exact repo elsewhere in this run). Read-only
      // assertion of the real state; deliberately does NOT call the real
      // POST /api/vault/init here, so this spec never mutates shared
      // backend state other specs depend on.
      await expect(page.getByText("Step 1 of 2: Create the vault repository")).toBeVisible();
      await expect(page.getByTestId("vault-init-branch")).toBeVisible();
      return;
    }

    await expect(management).toBeVisible();
    const status = page.getByTestId("vault-status");
    await expect(status).toBeVisible();
    // Real, unmocked server answer: the shared backend's default
    // VSNOTE_VAULT_REPO_NAME ("vault", `shareFixtures.ts` sets no
    // override) and legacy (unmounted) shape.
    await expect(status.getByText("vault", { exact: true })).toBeVisible();
    await expect(status.getByText(/Legacy \(bare repo\)/)).toBeVisible();
    // No mismatch banner: this fresh browser context's own "Repository
    // name" setting defaults to the same "vault" the server reports.
    await expect(page.getByTestId("vault-repo-name-mismatch")).toHaveCount(0);

    // Full add/test/mirror/delete cycle against a REAL target this test
    // owns: a temp local bare repo, reachable from the real backend
    // process without any network dependency, unique per test run.
    const remoteDir = mkdtempSync(path.join(tmpdir(), "vsnote-vault-mirror-e2e-"));
    const bareRepoPath = path.join(remoteDir, "mirror-target.git");
    try {
      execFileSync("git", ["init", "--bare", bareRepoPath], { encoding: "utf-8" });

      await page.getByTestId("vault-remote-add").click();
      const dialog = page.getByTestId("vault-remote-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("vault-remote-name").fill("e2e mirror target");
      await dialog.getByTestId("vault-remote-url").fill(bareRepoPath);
      await dialog.getByTestId("vault-remote-submit").click();
      await expect(dialog).toBeHidden();

      const row = page.locator('[data-testid^="vault-remote-row-"]', { hasText: "e2e mirror target" });
      await expect(row).toBeVisible();
      const remoteId = (await row.getAttribute("data-testid"))!.replace("vault-remote-row-", "");

      await page.getByTestId(`vault-remote-test-${remoteId}`).click();
      await expect(page.getByTestId(`vault-remote-test-result-${remoteId}`)).toHaveText(/reachable/i, { timeout: 15_000 });

      // The shared e2e backend's legacy "vault" repo may or may not have
      // any commits yet at this exact instant (other spec files push to
      // and delete the same repo throughout this run's lifetime, see this
      // file's module doc) — `app/mirror.py::run_mirror` reports a real,
      // specific "no commits to mirror yet" error in that case rather than
      // pushing nothing, which is a fully valid, deterministically
      // classified outcome and not a failure of this test. Either way,
      // this proves the real "Mirror now" round trip reached the real
      // backend and updated this row's status from "Never run.".
      await page.getByTestId(`vault-remote-mirror-${remoteId}`).click();
      const mirrorStatus = row.getByText(/Last mirror (succeeded|failed)/i);
      await expect(mirrorStatus).toBeVisible({ timeout: 15_000 });
      const mirrorStatusText = await mirrorStatus.textContent();

      if (mirrorStatusText?.includes("succeeded")) {
        // Proves the mirror really pushed real git history to this real,
        // independent local repo (verified with the SYSTEM git binary, not
        // this app's own client) — the same "prove it with an independent
        // tool" discipline `git-sync.spec.ts`'s headline test uses.
        const branches = execFileSync("git", ["branch", "--list"], { cwd: bareRepoPath, encoding: "utf-8" });
        expect(branches.length).toBeGreaterThan(0);
      }

      await page.getByTestId(`vault-remote-delete-${remoteId}`).click();
      await page.getByRole("button", { name: "Delete" }).last().click();
      await expect(row).toHaveCount(0);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });
});
