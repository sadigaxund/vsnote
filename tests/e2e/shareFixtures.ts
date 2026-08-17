/**
 * Phase 10 (sharing) e2e fixture — spawns a REAL instance of the Phase 9
 * backend (`server/`) against a temporary SQLite DB, bootstraps one owner
 * account (same idempotent trick `server/scripts/demo.sh` uses — Phase 9
 * ships no self-serve registration endpoint, by design: `server/app/
 * routers/auth.py` only ever logs an EXISTING user in), and tears it down
 * by the exact PID this fixture spawned.
 *
 * Port 8788 (never 8787 — that's `npm run server`'s port, never 5173/5290 —
 * those are other apps'/this suite's own SPA port) per the phase brief.
 * `--reload` is deliberately omitted (spawns a harder-to-kill process
 * tree). `VSNOTE_COOKIE_SECURE=false` since Playwright drives everything
 * over plain `http://127.0.0.1` in this suite.
 *
 * ONE backend for the WHOLE e2e run, not one per spec file. `playwright.
 * config.ts`'s `webServer` builds a single `vite preview` server shared by
 * every worker, and that server's share-route proxy target
 * (`VSNOTE_SHARE_PROXY_TARGET`, see `vite.config.ts`) is baked in once at
 * build time — so every worker MUST talk to the same backend on the same
 * port; per-worker ports would break the proxy. `startShareBackend()` /
 * `stopShareBackend()` are therefore called exactly once each, from
 * `tests/e2e/globalSetup.ts` / `tests/e2e/globalTeardown.ts` (wired into
 * `playwright.config.ts`'s `globalSetup`/`globalTeardown`), never from a
 * spec file's own `beforeAll`/`afterAll` — four spec files each starting
 * and stopping a server bound to the same fixed port raced each other
 * (only one can hold the port at a time), which is exactly the bug this
 * global-setup arrangement replaces.
 *
 * Since every spec now shares one backend and one database, share rows
 * created by different spec files coexist in the same DB for the whole
 * run. That's safe here because: (1) every share gets a fresh
 * cryptographically random 22-char slug (`server/app/security.py`,
 * ~131 bits) with no dedup by source path, so two specs publishing the
 * same vault file never collide on the same row, and (2) every spec locates
 * ITS OWN share by that unique slug/identifier (see `shareUiHelpers.ts`'s
 * `revokeShareByLink` and `share-panel.spec.ts`'s row lookup) rather than
 * by absolute row count or position. The rate limits below are widened
 * (well past `server/app/config.py`'s defaults) for the same reason: those
 * limits used to reset per spec file (fresh process, fresh in-memory
 * limiter); now every spec's login/password-auth calls draw from the same
 * shared limiter for the whole run.
 *
 * globalSetup and globalTeardown are separate Node invocations — no shared
 * module state — so the spawned PID (and temp DB dir) are handed off via a
 * small JSON file under `test-results/` (already gitignored) rather than an
 * in-memory variable. `stopShareBackend()` works either way: called from
 * the SAME process that spawned the backend (in-memory `handle` is used),
 * or called cold from `globalTeardown.ts` (falls back to reading that file).
 * Either path kills EXACTLY that one PID — never a broad `pkill`/`killall`.
 *
 * Phase 11 (real sync) — `git-sync.spec.ts` reuses this EXACT backend
 * instance (same port 8788, same process) rather than spawning a second
 * one: it's the same `app.main:app` FastAPI app, which now also serves
 * `/git/*` (Phase 11's router) alongside `/api`/`/share`, so there's
 * nothing extra to start. `VSNOTE_GIT_ROOT` below points bare repos at a
 * subdirectory of this fixture's own `dbDir`, so they're created fresh and
 * cleaned up by the exact same `rmSync(dbDir, ...)` call the sqlite file
 * already relied on — no separate teardown path to maintain.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `package.json`'s `"type": "module"` means this file has no `__dirname` —
// derive it from `import.meta.url` instead (the standard ESM equivalent).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SHARE_BACKEND_PORT = 8788;
export const SHARE_BACKEND_BASE_URL = `http://127.0.0.1:${SHARE_BACKEND_PORT}`;

export const DEMO_OWNER_USERNAME = "e2e-owner";
export const DEMO_OWNER_PASSWORD = "e2e-owner-password-1";
/** The bootstrap SQL below sets this on the owner row, and
 * `auth.py`'s `AuthContext.principal` resolves to `user.email or
 * user.username` — email wins whenever it's set — so any per-principal
 * share grant meant to match the logged-in owner (round 6 items 11/12)
 * must target THIS value, not `DEMO_OWNER_USERNAME`. */
export const DEMO_OWNER_EMAIL = "e2e-owner@example.com";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SERVER_DIR = path.join(REPO_ROOT, "server");
const PYTHON = path.join(SERVER_DIR, ".venv", "bin", "python");

// Handoff file between globalSetup's process and globalTeardown's process
// (see module docstring). Lives under the existing, gitignored
// `test-results/` dir so it never needs its own cleanup/gitignore entry.
const HANDLE_FILE = path.join(REPO_ROOT, "test-results", "share-backend-handle.json");

interface HandleFileContents {
  pid: number;
  dbDir: string;
}

interface ShareBackendHandle {
  proc: ChildProcessWithoutNullStreams;
  dbDir: string;
}

let handle: ShareBackendHandle | null = null;

async function waitForReady(baseUrl: string, proc: ChildProcessWithoutNullStreams, output: { text: string }, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  let exitInfo = "";
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exited = true;
    exitInfo = `exited early (code=${code}, signal=${signal})`;
  };
  proc.once("exit", onExit);
  try {
    while (Date.now() < deadline) {
      if (exited) {
        throw new Error(`Share backend ${exitInfo} before becoming ready.\n--- uvicorn output ---\n${output.text}`);
      }
      try {
        const res = await fetch(`${baseUrl}/api/auth/whoami`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(
      `Share backend did not become ready within ${timeoutMs}ms.\n--- uvicorn output so far ---\n${output.text}`,
    );
  } finally {
    proc.off("exit", onExit);
  }
}

function runPython(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, args, { cwd: SERVER_DIR, env });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`bootstrap failed (${code}): ${stderr}`))));
    proc.on("error", reject);
  });
}

/** Spawns the real backend, waits for it to answer, and bootstraps
 * `DEMO_OWNER_USERNAME`/`DEMO_OWNER_PASSWORD`. Called exactly once per
 * whole test run, from `globalSetup.ts`. Fails loudly (throws, including
 * captured uvicorn stdout/stderr) rather than hanging if the process exits
 * early or never becomes ready — e.g. because port 8788 is already bound by
 * something else. */
export async function startShareBackend(): Promise<void> {
  if (handle) return;
  const dbDir = mkdtempSync(path.join(tmpdir(), "vsnote-share-e2e-"));
  const dbUrl = `sqlite:///${path.join(dbDir, "test.db")}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VSNOTE_DB_URL: dbUrl,
    // Phase 11 — see module docstring. tmp_path-scoped alongside the sqlite
    // file, so it's cleaned up by this fixture's own `rmSync(dbDir, ...)`.
    VSNOTE_GIT_ROOT: path.join(dbDir, "git-repos"),
    VSNOTE_COOKIE_SECURE: "false",
    VSNOTE_ENV: "dev",
    VSNOTE_SECRET_KEY: "e2e-fixed-secret-key-not-for-prod-use",
    VSNOTE_SESSION_TTL_MIN: "30",
    // Widened well past `server/app/config.py`'s defaults (5/min, 60/min):
    // one backend now serves every spec file in the run instead of each
    // file getting its own fresh in-memory limiter, so the same handful of
    // login/password-auth calls per spec now draw from one shared bucket.
    // See module docstring.
    VSNOTE_RATE_LIMIT_SHARE_AUTH: "1000/minute",
    VSNOTE_RATE_LIMIT_SHARE: "5000/minute",
    // Phase 17's app-wide login gate (`server/app/routers/app_config.py`)
    // turns itself on as soon as a credential path exists, and this
    // fixture bootstraps an owner account below — so without this switch
    // every spec in the suite would meet a login screen instead of the
    // shell. The gate itself is covered by its own spec, which drives the
    // real login flow with the real owner credentials rather than
    // wallpapering over it here.
    VSNOTE_REQUIRE_LOGIN: "false",
  };

  // Bootstrap the owner account directly against the DB file, same
  // approach as `server/scripts/demo.sh` — there is no owner-registration
  // HTTP endpoint (Phase 9 deliberately ships none).
  await runPython(
    [
      "-c",
      `
from app.db import make_engine, make_sessionmaker, Base
from app import models, security
import os
engine = make_engine(os.environ["VSNOTE_DB_URL"])
Base.metadata.create_all(engine)
db = make_sessionmaker(engine)()
if db.query(models.User).filter(models.User.username == "${DEMO_OWNER_USERNAME}").one_or_none() is None:
    db.add(models.User(username="${DEMO_OWNER_USERNAME}", password_hash=security.hash_password("${DEMO_OWNER_PASSWORD}"), email="e2e-owner@example.com", is_admin=True))
    db.commit()
db.close()
`.trim(),
    ],
    env,
  );

  const proc = spawn(
    PYTHON,
    ["-m", "uvicorn", "app.main:app", "--app-dir", SERVER_DIR, "--port", String(SHARE_BACKEND_PORT)],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = { text: "" };
  proc.stdout.on("data", (d) => (output.text += d.toString()));
  proc.stderr.on("data", (d) => (output.text += d.toString()));

  try {
    await waitForReady(SHARE_BACKEND_BASE_URL, proc, output);
  } catch (err) {
    // Never leak a half-started process on a failed setup.
    try {
      proc.kill("SIGKILL");
    } catch {
      // already gone
    }
    rmSync(dbDir, { recursive: true, force: true });
    throw err;
  }

  handle = { proc, dbDir };
  mkdirSync(path.dirname(HANDLE_FILE), { recursive: true });
  writeFileSync(HANDLE_FILE, JSON.stringify({ pid: proc.pid, dbDir } satisfies HandleFileContents));
}

/** Waits (polling `process.kill(pid, 0)`) for `pid` to no longer exist. */
async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // signal 0: existence check only, no-op if alive
    } catch {
      return true; // ESRCH — process is gone
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Kills EXACTLY the PID `startShareBackend` spawned (never a broad
 * `pkill`) and removes the temporary DB directory. Works whether called
 * from the same process that spawned the backend (uses the in-memory
 * `ChildProcess`, so we get a clean 'exit' event) or cold from
 * `globalTeardown.ts` (falls back to the PID/dbDir recorded in
 * `HANDLE_FILE` by `startShareBackend`, and polls for exit instead). */
export async function stopShareBackend(): Promise<void> {
  if (handle) {
    const { proc, dbDir } = handle;
    handle = null;
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      proc.kill("SIGTERM");
      // Belt-and-suspenders: uvicorn without --reload exits promptly on
      // SIGTERM, but force it after a short grace period so teardown never
      // hangs the whole run.
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already gone
        }
        resolve();
      }, 5_000);
    });
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(HANDLE_FILE, { force: true });
    return;
  }

  if (!existsSync(HANDLE_FILE)) return;
  const { pid, dbDir } = JSON.parse(readFileSync(HANDLE_FILE, "utf-8")) as HandleFileContents;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  let exited = await waitForPidExit(pid, 5_000);
  if (!exited) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
    exited = await waitForPidExit(pid, 5_000);
  }
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(HANDLE_FILE, { force: true });
}
