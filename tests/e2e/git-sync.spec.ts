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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { DEFAULT_ACTIVE_PATH, gotoApp, tab } from "./fixtures";
import { signInToShareBackend } from "./shareUiHelpers";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME, SHARE_BACKEND_PORT } from "./shareFixtures";

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

test.describe("Real git sync (Phase 11)", () => {
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
});
