/**
 * Narrated, re-runnable proof of the Phase 11 auto-merge/conflict-resolver
 * pipeline (roadmap §5.2) — run via `server/scripts/sync-merge-demo.sh`,
 * which starts a REAL scratch backend and invokes this file with
 * `npx vitest run --config tests/manual/vitest.config.ts`.
 *
 * Unlike a bash/curl script, this drives the app's OWN client modules
 * (`src/git/sync.ts`, `src/git/remote.ts`, `src/git/backupRefs.ts`) —
 * exactly what `useGitStore.ts`'s `syncNow`/`resolveConflict` call — against
 * a real running backend, over real HTTP (Node 22's global `fetch`, same as
 * `isomorphic-git/http/web` uses in a browser), so this is a genuine proof
 * of the SAME code the browser runs, not a bash reimplementation of the
 * merge policy that could quietly drift out of sync with it. The lightning-
 * fs + `fake-indexeddb` combination is the exact one `tests/unit/setup.ts`
 * already uses for the automated unit suite (see that file's doc) — this
 * demo reuses it for a live-backend scenario instead of pure offline logic.
 *
 * Real `expect()` assertions throughout (a genuine `it()`, not a bare
 * script) — `vitest run` exits non-zero on any failure, so this is safe to
 * wire into CI later, same as `single_origin_navigation_demo.sh`'s bash
 * assertions are.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import * as git from "isomorphic-git";
import { fs, GIT_DIR, DEFAULT_BRANCH, DEMO_AUTHOR } from "../../src/git/client";
import { writeFile as writeVaultFile } from "../../src/fs/operations";
import { repoToFsPath } from "../../src/fs/paths";
import { realPush, type RemoteConfig } from "../../src/git/remote";
import { runSync, resolveConflictAndPush } from "../../src/git/sync";
import { listBackupRefs } from "../../src/git/backupRefs";

const BASE_URL = process.env.SLATE_DEMO_BASE_URL;
const TOKEN = process.env.SLATE_DEMO_TOKEN;
const REPO_NAME = process.env.SLATE_DEMO_REPO ?? "demo-vault";

if (!BASE_URL || !TOKEN) {
  throw new Error(
    "syncMergeDemo.spec.ts requires SLATE_DEMO_BASE_URL and SLATE_DEMO_TOKEN — run via server/scripts/sync-merge-demo.sh, not directly.",
  );
}

const config: RemoteConfig = { url: `${BASE_URL}/git/${REPO_NAME}.git`, token: TOKEN };

function log(line: string): void {
  console.log(line);
}

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf-8",
    timeout: 20_000,
  });
}

const workDirs: string[] = [];
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  workDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

async function writeAndStage(repoPath: string, content: string): Promise<void> {
  await writeVaultFile(repoToFsPath(repoPath), content);
  await git.add({ fs, dir: GIT_DIR, filepath: repoPath });
}

async function commitLocal(message: string): Promise<void> {
  await git.commit({ fs, dir: GIT_DIR, message, author: DEMO_AUTHOR });
}

it(
  "real backend: baseline push, disjoint divergence auto-merges + pushes with a backup ref, then a genuine same-line conflict is DETECTED (never silently clobbered) and resolving it pushes a real merge commit",
  async () => {
    const runId = `${Date.now()}`;

    log("\n=== 1. Baseline: init a fresh local repo, commit, push into a brand-new backend repo ===");
    await git.init({ fs, dir: GIT_DIR, defaultBranch: DEFAULT_BRANCH });
    await writeAndStage("notes/demo.md", `# Sync merge demo\n\nbaseline-${runId}\nCONFLICT-LINE-${runId}\n`);
    await writeAndStage("notes/other.md", `# Untouched by anyone\n`);
    await commitLocal(`baseline ${runId}`);
    const baselineStatus = await realPush(config, DEFAULT_BRANCH);
    expect(baselineStatus.ahead).toBe(0);
    expect(baselineStatus.behind).toBe(0);
    log(`  pushed baseline — ${config.url}, branch ${DEFAULT_BRANCH}`);

    // === 2. Disjoint-file divergence: a "second device" (system git) edits ===
    // === a DIFFERENT file and pushes; the local client edits ANOTHER      ===
    // === different file and leaves it uncommitted, matching what          ===
    // === `useGitStore.ts::syncNow` does before calling `runSync`.         ===
    log("\n=== 2. Disjoint-file divergence: auto-merge, no conflict ===");
    const cloneDir = scratchDir("slate-sync-demo-clone-");
    runGit(["clone", `http://x:${TOKEN}@${new URL(BASE_URL).host}/git/${REPO_NAME}.git`, cloneDir], path.dirname(cloneDir));
    runGit(["config", "user.email", "second-device@example.com"], cloneDir);
    runGit(["config", "user.name", "Second Device"], cloneDir);
    const otherPath = path.join(cloneDir, "notes/other.md");
    writeFileSync(otherPath, `${readFileSync(otherPath, "utf-8")}remote-edit-${runId}\n`);
    runGit(["add", "notes/other.md"], cloneDir);
    runGit(["commit", "-q", "-m", `remote edit ${runId}`], cloneDir);
    runGit(["push", "origin", DEFAULT_BRANCH], cloneDir);
    log("  second device pushed an edit to notes/other.md");

    const demoOidBeforeLocalEdit = await git.resolveRef({ fs, dir: GIT_DIR, ref: DEFAULT_BRANCH });
    const demoContentBeforeLocalEdit = new TextDecoder().decode(
      (await git.readBlob({ fs, dir: GIT_DIR, oid: demoOidBeforeLocalEdit, filepath: "notes/demo.md" })).blob,
    );
    await writeAndStage("notes/demo.md", `${demoContentBeforeLocalEdit}local-edit-${runId}\n`);
    await commitLocal(`local edit ${runId}`); // mirrors syncNow's auto-commit of uncommitted changes
    log("  local client committed an edit to notes/demo.md (different file)");

    const mergeOutcome = await runSync(config, DEFAULT_BRANCH, "Synced from {device}: {timestamp}", "demo-device");
    expect(mergeOutcome.action).toBe("merged");
    expect(mergeOutcome.status.ahead).toBe(0);
    expect(mergeOutcome.status.behind).toBe(0);
    log(`  runSync() action="${mergeOutcome.action}" — ahead=${mergeOutcome.status.ahead} behind=${mergeOutcome.status.behind}`);

    const backupRefsAfterMerge = await listBackupRefs();
    expect(backupRefsAfterMerge.some((name) => name.startsWith("pre-sync-"))).toBe(true);
    log(`  backup refs present: ${JSON.stringify(backupRefsAfterMerge)}`);

    const verifyDir1 = scratchDir("slate-sync-demo-verify1-");
    runGit(["clone", `http://x:${TOKEN}@${new URL(BASE_URL).host}/git/${REPO_NAME}.git`, verifyDir1], path.dirname(verifyDir1));
    const otherContent = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/other.md`], verifyDir1);
    const demoContent = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/demo.md`], verifyDir1);
    expect(otherContent).toContain(`remote-edit-${runId}`);
    expect(demoContent).toContain(`local-edit-${runId}`);
    log("  independent system-git clone confirms BOTH edits landed in one pushed merge commit\n");

    // === 3. Same-line conflict: both sides edit the identical line ===
    log("=== 3. Same-line conflict: detected, nothing pushed until resolved ===");
    const cloneDir2 = scratchDir("slate-sync-demo-clone2-");
    runGit(["clone", `http://x:${TOKEN}@${new URL(BASE_URL).host}/git/${REPO_NAME}.git`, cloneDir2], path.dirname(cloneDir2));
    runGit(["config", "user.email", "second-device@example.com"], cloneDir2);
    runGit(["config", "user.name", "Second Device"], cloneDir2);
    const demoPath2 = path.join(cloneDir2, "notes/demo.md");
    const beforeConflict = readFileSync(demoPath2, "utf-8");
    expect(beforeConflict).toContain(`CONFLICT-LINE-${runId}`);
    writeFileSync(demoPath2, beforeConflict.replace(`CONFLICT-LINE-${runId}`, `CONFLICT-LINE-${runId} REMOTE-EDIT`));
    runGit(["add", "notes/demo.md"], cloneDir2);
    runGit(["commit", "-q", "-m", `remote edits the conflict line ${runId}`], cloneDir2);
    runGit(["push", "origin", DEFAULT_BRANCH], cloneDir2);
    log("  second device rewrote CONFLICT-LINE in notes/demo.md and pushed");

    const currentHeadOid = await git.resolveRef({ fs, dir: GIT_DIR, ref: DEFAULT_BRANCH });
    const currentDemoContent = new TextDecoder().decode(
      (await git.readBlob({ fs, dir: GIT_DIR, oid: currentHeadOid, filepath: "notes/demo.md" })).blob,
    );
    await writeAndStage("notes/demo.md", currentDemoContent.replace(`CONFLICT-LINE-${runId}`, `CONFLICT-LINE-${runId} LOCAL-EDIT`));
    await commitLocal(`local edits the conflict line ${runId}`);
    log("  local client rewrote the SAME line differently and committed (uncommitted->auto-committed, same as Sync does)");

    const conflictOutcome = await runSync(config, DEFAULT_BRANCH, "Synced from {device}: {timestamp}", "demo-device");
    expect(conflictOutcome.action).toBe("conflict");
    expect(conflictOutcome.conflict).toBeDefined();
    const conflict = conflictOutcome.conflict!;
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts[0].path).toBe("notes/demo.md");
    expect(conflict.conflicts[0].kind).toBe("content");
    log(`  runSync() action="${conflictOutcome.action}" — conflicted file(s): ${conflict.conflicts.map((c) => c.path).join(", ")}`);

    // The critical honesty check: the LOCAL side's edit — the one thing
    // only a completed sync could have pushed — must NOT be on the remote
    // yet (the remote's own "theirs" commit from the second device above
    // is legitimately already there; that's the other half of the
    // divergence, not evidence of anything being clobbered). Proves the
    // conflict was genuinely detected and held back, not silently resolved
    // toward either side.
    const midCloneDir = scratchDir("slate-sync-demo-midclone-");
    runGit(["clone", `http://x:${TOKEN}@${new URL(BASE_URL).host}/git/${REPO_NAME}.git`, midCloneDir], path.dirname(midCloneDir));
    const midContent = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/demo.md`], midCloneDir);
    expect(midContent).toContain("REMOTE-EDIT"); // the second device's own legitimate push
    expect(midContent).not.toContain("LOCAL-EDIT"); // the local side's edit was NOT silently pushed/merged
    log("  confirmed via independent clone: remote shows the second device's edit but NOT the local edit — nothing was silently clobbered");

    // Resolve: "take theirs" for the one conflicted file.
    const resolutions: Record<string, string | null> = {
      "notes/demo.md": conflict.conflicts[0].theirs ?? null,
    };
    const resolvedStatus = await resolveConflictAndPush(config, conflict, resolutions);
    expect(resolvedStatus.ahead).toBe(0);
    expect(resolvedStatus.behind).toBe(0);
    log("  resolved via 'take theirs' and pushed");

    const backupRefsAfterResolve = await listBackupRefs();
    expect(backupRefsAfterResolve.some((name) => name.startsWith("pre-sync-"))).toBe(true);
    log(`  backup refs present after resolution: ${JSON.stringify(backupRefsAfterResolve)}`);

    const verifyDir2 = scratchDir("slate-sync-demo-verify2-");
    runGit(["clone", `http://x:${TOKEN}@${new URL(BASE_URL).host}/git/${REPO_NAME}.git`, verifyDir2], path.dirname(verifyDir2));
    const mergeOid = runGit(["rev-parse", `origin/${DEFAULT_BRANCH}`], verifyDir2).trim();
    const parents = runGit(["log", "-1", "--format=%P", mergeOid], verifyDir2).trim().split(/\s+/);
    expect(parents).toHaveLength(2);
    const finalContent = runGit(["show", `origin/${DEFAULT_BRANCH}:notes/demo.md`], verifyDir2);
    expect(finalContent).toContain(`CONFLICT-LINE-${runId} REMOTE-EDIT`);
    expect(finalContent).not.toContain("LOCAL-EDIT");
    log(`  independent clone confirms a real two-parent merge commit (${mergeOid}), content = REMOTE-EDIT as resolved\n`);

    log("=== Demo complete: real backend, real client modules, real system-git verification at every step. ===");
  },
);
