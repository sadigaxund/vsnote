/**
 * Phase 11 exit criteria — THE headline proof that sync is real, end to
 * end, driven from a real browser and verified with an independent tool
 * (system `git`, not this app's own isomorphic-git client):
 *
 *   1. Sign in to the (already-running, shared — see `shareFixtures.ts`'s
 *      module doc) Phase 9 backend from Settings → Sharing, and generate a
 *      real `write`-scoped API token from Settings → Git & Sync (the exact
 *      Phase 9 token model `/git/*` authenticates with — no fixture-side
 *      shortcut, no token minted outside the browser).
 *   2. Edit a real file, commit it (Source Control panel), and push
 *      (Source Control panel's Push button) — all real UI interaction.
 *   3. From Node (this spec's own process, NOT the browser), `git clone`
 *      the bare repo with the SYSTEM `git` binary and show the commit made
 *      in the app is really there — a plain clone, fully readable, no
 *      app/decryption involved (roadmap §4: the vault stays plaintext).
 *   4. Show a token-less push being rejected by the same real server.
 *
 * Re-runnable: the repo name is fixed ("vault", Phase 10.5a — the app's own
 * `git/remote.ts::computeGitRemoteUrl` has no configurable Remote URL field
 * anymore, roadmap §5.4), but that's still collision-free across runs
 * because `SLATE_GIT_ROOT` is a fresh `mkdtempSync` directory per backend
 * PROCESS (see `shareFixtures.ts`) — every whole e2e run starts with an
 * empty `git-repos/`, so "vault.git" never carries state from a previous
 * run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_ACTIVE_PATH, gotoApp, tab } from "./fixtures";
import { signInToShareBackend } from "./shareUiHelpers";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME, SHARE_BACKEND_PORT } from "./shareFixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const HANDLE_FILE = path.join(REPO_ROOT, "test-results", "share-backend-handle.json");

const DEFAULT_BRANCH = "feat/incremental-index";

// Phase 10.5a (single-origin refactor, roadmap §5.4): the sync remote is no
// longer a Settings-configurable URL — it's implicitly `<origin>/git/
// vault.git`, a FIXED repo name ("vault"), same as the app's own
// `git/remote.ts::computeGitRemoteUrl`. This is still collision-free across
// re-runs: `shareFixtures.ts`'s `SLATE_GIT_ROOT` is a fresh `mkdtempSync`
// directory per e2e RUN (never reused across runs), so "vault.git" starts
// empty every time this whole suite starts, regardless of how many times
// it's been run before.
const REPO_NAME = "vault";

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf-8",
    timeout: 20_000,
  });
}

/** Runs `git` and returns { ok, output } instead of throwing — used for the
 * "this MUST fail" assertions (token-less push) so the failure's stderr is
 * available to assert on rather than just an exception. */
function runGitExpectFailure(args: string[], cwd: string): { stdout: string; stderr: string } {
  try {
    const stdout = runGit(args, cwd);
    throw new Error(`expected 'git ${args.join(" ")}' to fail, but it succeeded:\n${stdout}`);
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    if (e.status === undefined) throw err; // not a git-exit-code failure — rethrow (e.g. our own throw above)
    return { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

/**
 * Deletes the shared "vault.git" bare repo on the REAL backend's own disk
 * (via the `dbDir` the `globalSetup` fixture recorded in `HANDLE_FILE` for
 * teardown — see `shareFixtures.ts`'s module doc) so the test calling this
 * gets a genuinely bootstrap-fresh repo (a 404 on first fetch, unconditional
 * first push — `git/remote.ts::realPush`'s documented "bootstrap case").
 *
 * Why this is necessary: every test in this file gets an ISOLATED browser
 * context (Playwright's default), so its in-app vault/git history is a
 * brand-new demo-vault seed with a wall-clock commit timestamp — a
 * completely unrelated git object graph from whatever any OTHER test in
 * this shared-backend-for-the-whole-run file already pushed to the fixed
 * "vault" repo name (Phase 10.5a, roadmap §5.4 — the sync remote has no
 * configurable name, so every app-driven test necessarily targets the
 * SAME repo). Without a reset, a second test's fresh app would see the
 * leftover repo as "diverged" from unrelated history on its very first
 * fetch — a confusing, non-representative failure mode that has nothing to
 * do with the auto-merge policy this file's new tests actually verify.
 * Declared AFTER the pre-existing exit-criteria test above (and this
 * describe block is `mode: "serial"`, so execution order is guaranteed,
 * never interleaved) — that test's own assertions have already completed
 * by the time any of the resets below run, so this never touches state a
 * still-running assertion depends on.
 */
function resetVaultRepo(): void {
  const { dbDir } = JSON.parse(readFileSync(HANDLE_FILE, "utf-8")) as { dbDir: string };
  const repoPath = path.join(dbDir, "git-repos", "vault.git");
  if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true });
}

/** Appends a line to a file inside a system-git clone, commits, and pushes
 * — the "simulate a second device that already synced" step both new
 * tests below use to build a real, disjoint commit onto whatever the app
 * itself most recently pushed (a genuine fast-forward from the remote's
 * point of view, same as any real second clone). */
function pushExtraCommit(cloneDir: string, relFile: string, appendLine: string, commitMessage: string, branch: string): void {
  const filePath = path.join(cloneDir, relFile);
  const before = readFileSync(filePath, "utf-8");
  writeFileSync(filePath, `${before.replace(/\n$/, "")}\n${appendLine}\n`);
  runGit(["add", relFile], cloneDir);
  runGit(["commit", "-q", "-m", commitMessage], cloneDir);
  runGit(["push", "origin", branch], cloneDir);
}

/** Signs in and mints a real write-scoped token from the UI (the same
 * steps test 1 above does inline) — factored out since both new tests
 * below need their own fresh one (isolated browser context per test, so
 * neither the session nor any token from another test carries over). */
async function signInAndGenerateToken(page: Page): Promise<string> {
  await gotoApp(page);
  await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
  await page.getByTestId("settings-nav-git-sync").click();
  await page.getByTestId("git-generate-token").click();
  const tokenInput = page.getByLabel("Personal access token");
  await expect(tokenInput).not.toHaveValue("");
  return tokenInput.inputValue();
}

/** Opens `displayName` (e.g. "reading-list.md") via ⌘P quick-open and
 * switches it to Source mode — same pattern
 * `palette-settings-zen-durability.spec.ts`'s Ctrl+P test uses. */
async function openFileInSource(page: Page, query: string, displayName: string): Promise<void> {
  await page.keyboard.press("Control+p");
  const dialog = page.getByRole("dialog");
  await page.keyboard.type(query);
  await dialog.getByRole("button", { name: displayName }).click();
  await page.getByRole("radio", { name: "Source" }).click();
}

test.describe("Real git sync (Phase 11, roadmap §5.2 — fast-forward/push, disjoint auto-merge, and conflict resolution)", () => {
  test.describe.configure({ mode: "serial" });

  test("edit -> commit -> push in the app; system git clone proves the commit is really there; token-less push is rejected", async ({
    page,
  }) => {
    const marker = `sync-proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // --- 1. Sign in + generate a real write-scoped token, from the UI ----
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    await page.getByTestId("settings-nav-git-sync").click();
    // No more Remote URL field to fill (Phase 10.5a, roadmap §5.4) — the
    // remote is implicitly `<origin>/git/vault.git`, visible read-only in
    // the Repository DataList above this row.
    await expect(page.getByText(/\/git\/vault\.git$/)).toBeVisible();

    await page.getByTestId("git-generate-token").click();
    const tokenInput = page.getByLabel("Personal access token");
    // Real network round-trip (POST /api/auth/tokens) — wait for the field
    // to actually populate rather than a bare timeout.
    await expect(tokenInput).not.toHaveValue("");
    const token = await tokenInput.inputValue();
    expect(token.startsWith("slt_")).toBe(true);

    // "Test connection" — real reachability/auth round-trip against a repo
    // that doesn't exist yet (created on first push): reachable + authed,
    // not an error.
    await page.getByTestId("git-test-connection").click();
    await expect(page.getByTestId("git-test-result")).toHaveText(/repo will be created on first push/);

    // --- 2. Edit a real file, commit, push — all real UI interaction -----
    // Switch back to the file tab — Settings is still the active/selected
    // tab from step 1's configuration (opening Settings doesn't replace
    // the file's own tab, per SettingsView.tsx's doc, but it DOES become
    // the focused one).
    await tab(page, DEFAULT_ACTIVE_PATH).click();
    await page.getByRole("button", { name: "Source Control" }).click();
    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n${marker}\n`);
    await page.keyboard.press("Control+s");

    await page.getByLabel("Commit message").fill(`Phase 11 sync proof: ${marker}`);
    await page.getByRole("button", { name: "Commit" }).click();
    // Commit clears the message box on success (SourceControlPanel.tsx).
    await expect(page.getByLabel("Commit message")).toHaveValue("");

    await page.getByRole("button", { name: "Push" }).click();
    // A real, explicit success signal (SourceControlPanel.tsx's push
    // toast) — NOT just "no failure toast" (which would pass vacuously if
    // the push silently never ran) and NOT just "↑0 ↓0" in the status bar
    // (which is ALSO the pre-push "never synced yet" display, since ahead/
    // behind read 0/0 before the first-ever fetch too — see useGitStore's
    // doc on `hasRemoteRef`). This toast only fires after `push()`
    // actually resolves with no `syncError`.
    await expect(page.getByText("Pushed to remote", { exact: true })).toBeVisible();
    await expect(page.getByTestId("app-statusbar")).not.toContainText("not synced yet");

    // --- 3. Independent proof: system git clone, outside the app ---------
    const workDir = mkdtempSync(path.join(tmpdir(), "slate-git-sync-e2e-"));
    try {
      const cloneDir = path.join(workDir, "clone");
      runGit(["clone", `http://x:${token}@127.0.0.1:${SHARE_BACKEND_PORT}/git/${REPO_NAME}.git`, cloneDir], workDir);

      const log = runGit(["log", "--oneline", `origin/${DEFAULT_BRANCH}`], cloneDir);
      expect(log).toContain(`Phase 11 sync proof: ${marker}`);
      console.log(`\n--- git log --oneline origin/${DEFAULT_BRANCH} (real system git, independent of the app) ---\n${log}`);

      const content = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/architecture.md`], cloneDir);
      expect(content).toContain(marker);
      console.log(`--- git show origin/${DEFAULT_BRANCH}:notes/architecture.md (tail) ---\n${content.split("\n").slice(-4).join("\n")}`);

      // --- 4. Token-less push rejected, same real server ------------------
      // A trivial follow-up commit in the clone, pushed with NO credentials
      // (explicit empty creds so `git` sends the request instead of hanging
      // on an interactive prompt — GIT_TERMINAL_PROMPT=0 already forbids
      // that anyway, this just keeps the URL well-formed).
      runGit(["config", "user.email", "e2e@example.com"], cloneDir);
      runGit(["config", "user.name", "E2E"], cloneDir);
      runGit(["commit", "--allow-empty", "-q", "-m", "should never reach the remote"], cloneDir);
      const rejected = runGitExpectFailure(
        ["push", `http://x:@127.0.0.1:${SHARE_BACKEND_PORT}/git/${REPO_NAME}.git`, DEFAULT_BRANCH],
        cloneDir,
      );
      expect(rejected.stderr.toLowerCase()).toMatch(/401|authentication/);
      console.log(`--- token-less push, real server, rejected ---\n${rejected.stderr.trim()}`);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("divergence with disjoint file edits auto-merges and pushes — no user interaction; backup ref created", async ({ page }) => {
    resetVaultRepo();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = await signInAndGenerateToken(page);

    // --- Baseline: app edits + commits (sweeps the seed's own pending
    // demo-state changes in too, same as any real commit would) + pushes
    // architecture.md into a genuinely empty repo (bootstrap case). ---
    await tab(page, DEFAULT_ACTIVE_PATH).click();
    await page.getByRole("button", { name: "Source Control" }).click();
    await page.getByRole("radio", { name: "Source" }).click();
    let cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\nbaseline-${runId}\n`);
    await page.keyboard.press("Control+s");
    await page.getByLabel("Commit message").fill(`baseline ${runId}`);
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.getByLabel("Commit message")).toHaveValue("");
    await page.getByRole("button", { name: "Push" }).click();
    await expect(page.getByText("Pushed to remote", { exact: true })).toBeVisible();

    const workDir = mkdtempSync(path.join(tmpdir(), "slate-git-merge-e2e-"));
    try {
      // --- Remote-only edit: a "second device" (system git) clones at the
      // baseline, edits a DIFFERENT file, pushes — a real fast-forward the
      // app hasn't fetched yet. ---
      const cloneDir = path.join(workDir, "clone");
      runGit(["clone", `http://x:${token}@127.0.0.1:${SHARE_BACKEND_PORT}/git/${REPO_NAME}.git`, cloneDir], workDir);
      runGit(["config", "user.email", "remote-device@example.com"], cloneDir);
      runGit(["config", "user.name", "Remote Device"], cloneDir);
      pushExtraCommit(cloneDir, "src/GraphView.tsx", `// remote-edit-${runId}`, `Remote edit ${runId}`, DEFAULT_BRANCH);

      // --- Local-only edit: a DIFFERENT file again, saved but deliberately
      // left UNCOMMITTED — proving Sync's own auto-commit (roadmap §5.3),
      // not a manual Commit click. ---
      await openFileInSource(page, "reading-list", "reading-list.md");
      cm = page.locator(".cm-content").first();
      await cm.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(`\nlocal-edit-${runId}\n`);
      await page.keyboard.press("Control+s");

      // --- Sync now: fetch reveals a genuine divergence over DISJOINT
      // files — auto-merges cleanly, no resolver, real push, no user
      // interaction beyond the one click. ---
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog").getByRole("button", { name: "Sync now" }).click();
      await expect(page.getByText("Synced with remote", { exact: true })).toBeVisible();
      await expect(page.getByTestId("conflict-resolver")).toHaveCount(0);
      await expect(page.getByTestId("app-statusbar")).toContainText("↑0 ↓0");

      // --- Backup ref genuinely exists — structural, not hopeful. ---
      const backupRefs = await page.evaluate(() =>
        (window as unknown as { __slateGitDebug: { listBackupRefs: () => Promise<string[]> } }).__slateGitDebug.listBackupRefs(),
      );
      expect(backupRefs.some((name) => name.startsWith("pre-sync-"))).toBe(true);
      console.log(`--- backup refs after auto-merge: ${JSON.stringify(backupRefs)} ---`);

      // --- Independent proof: a THIRD system git clone shows BOTH edits,
      // merged into one real commit. ---
      const verifyDir = path.join(workDir, "verify");
      runGit(["clone", `http://x:${token}@127.0.0.1:${SHARE_BACKEND_PORT}/git/${REPO_NAME}.git`, verifyDir], workDir);
      const graphContent = runGit(["show", `origin/${DEFAULT_BRANCH}:src/GraphView.tsx`], verifyDir);
      const readingListContent = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/reading-list.md`], verifyDir);
      expect(graphContent).toContain(`remote-edit-${runId}`);
      expect(readingListContent).toContain(`local-edit-${runId}`);
      console.log(
        `--- auto-merge proof (real system git, independent of the app): both remote-edit-${runId} (src/GraphView.tsx) and local-edit-${runId} (notes/reading-list.md) present in the pushed merge commit ---`,
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("same-line conflict opens the resolver; resolving it (Take theirs) pushes a real two-parent merge commit; backup ref created", async ({
    page,
  }) => {
    resetVaultRepo();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = await signInAndGenerateToken(page);
    const CONFLICT_MARKER = `CONFLICT-LINE-${runId}`;

    // --- Baseline: app appends a KNOWN, precisely-targetable LAST line
    // (no trailing newline, so Ctrl+End lands exactly on it every time),
    // commits, pushes into a genuinely empty repo. ---
    await tab(page, DEFAULT_ACTIVE_PATH).click();
    await page.getByRole("button", { name: "Source Control" }).click();
    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n${CONFLICT_MARKER}`);
    await page.keyboard.press("Control+s");
    await page.getByLabel("Commit message").fill(`baseline ${runId}`);
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.getByLabel("Commit message")).toHaveValue("");
    await page.getByRole("button", { name: "Push" }).click();
    await expect(page.getByText("Pushed to remote", { exact: true })).toBeVisible();

    const workDir = mkdtempSync(path.join(tmpdir(), "slate-git-conflict-e2e-"));
    try {
      // --- Remote-side edit: system git rewrites that EXACT line. ---
      const cloneDir = path.join(workDir, "clone");
      runGit(["clone", `http://x:${token}@127.0.0.1:${SHARE_BACKEND_PORT}/git/${REPO_NAME}.git`, cloneDir], workDir);
      runGit(["config", "user.email", "remote-device@example.com"], cloneDir);
      runGit(["config", "user.name", "Remote Device"], cloneDir);
      const filePath = path.join(cloneDir, "notes/architecture.md");
      const before = readFileSync(filePath, "utf-8");
      expect(before).toContain(CONFLICT_MARKER);
      writeFileSync(filePath, before.replace(CONFLICT_MARKER, `${CONFLICT_MARKER} REMOTE-EDIT`));
      runGit(["add", "notes/architecture.md"], cloneDir);
      runGit(["commit", "-q", "-m", `remote edits the conflict line ${runId}`], cloneDir);
      runGit(["push", "origin", DEFAULT_BRANCH], cloneDir);

      // --- Local-side edit: app edits the SAME line — its buffer still
      // shows the base content (it hasn't fetched the remote edit yet) —
      // saved but left UNCOMMITTED, same auto-commit proof as the other
      // test. Re-click the editor first: the Commit/Push buttons clicked
      // for the baseline above stole DOM focus away from it. ---
      await cm.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Shift+Home");
      await page.keyboard.type(`${CONFLICT_MARKER} LOCAL-EDIT`);
      await page.keyboard.press("Control+s");

      // --- Sync now: a TRUE conflict (same line, different content on
      // both sides) — the resolver opens; NOTHING pushed yet. ---
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog").getByRole("button", { name: "Sync now" }).click();
      const resolver = page.getByTestId("conflict-resolver");
      await expect(resolver).toBeVisible();
      await expect(resolver.getByTestId("conflict-file-notes/architecture.md")).toBeVisible();

      // Nothing pushed yet — verify a fresh clone right now sees NEITHER edit.
      const midCloneDir = path.join(workDir, "mid-clone");
      runGit(["clone", `http://x:${token}@127.0.0.1:${SHARE_BACKEND_PORT}/git/${REPO_NAME}.git`, midCloneDir], workDir);
      const midContent = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/architecture.md`], midCloneDir);
      expect(midContent).not.toContain("LOCAL-EDIT");

      // --- Resolve: "Take theirs" for the one conflicted file, then push. ---
      await resolver.getByRole("button", { name: "Take theirs" }).click();
      await resolver.getByTestId("conflict-resolve-push").click();
      await expect(resolver).toHaveCount(0);
      await expect(page.getByTestId("app-statusbar")).toContainText("↑0 ↓0");

      // --- Backup ref genuinely exists. ---
      const backupRefs = await page.evaluate(() =>
        (window as unknown as { __slateGitDebug: { listBackupRefs: () => Promise<string[]> } }).__slateGitDebug.listBackupRefs(),
      );
      expect(backupRefs.some((name) => name.startsWith("pre-sync-"))).toBe(true);
      console.log(`--- backup refs after conflict resolution: ${JSON.stringify(backupRefs)} ---`);

      // --- Independent proof: a real two-parent merge commit, content =
      // "theirs" (REMOTE-EDIT), never silently clobbered. ---
      const verifyDir = path.join(workDir, "verify");
      runGit(["clone", `http://x:${token}@127.0.0.1:${SHARE_BACKEND_PORT}/git/${REPO_NAME}.git`, verifyDir], workDir);
      const mergeOid = runGit(["rev-parse", `origin/${DEFAULT_BRANCH}`], verifyDir).trim();
      const parents = runGit(["log", "-1", "--format=%P", mergeOid], verifyDir).trim().split(/\s+/);
      expect(parents.length).toBe(2);
      const finalContent = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/architecture.md`], verifyDir);
      expect(finalContent).toContain(`${CONFLICT_MARKER} REMOTE-EDIT`);
      expect(finalContent).not.toContain("LOCAL-EDIT");
      console.log(
        `--- conflict resolved via "Take theirs" (real system git, independent of the app): merge commit ${mergeOid} has ${parents.length} parents, content = REMOTE-EDIT ---`,
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
