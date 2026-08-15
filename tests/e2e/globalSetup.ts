/**
 * Playwright `globalSetup` (wired in `playwright.config.ts`) — starts the
 * ONE share backend used by the entire e2e run, before any spec file runs
 * and before Playwright's own `webServer` (`vite preview`) starts. See
 * `shareFixtures.ts`'s module docstring for why this must be a single
 * shared backend rather than one per spec file.
 *
 * Runs in its own Node process, separate from every worker process AND
 * from `globalTeardown.ts` — `startShareBackend()` hands its spawned PID
 * off via a file under `test-results/` (see `shareFixtures.ts`) so
 * `globalTeardown.ts` can find and kill it cold.
 *
 * Throws (failing the whole run loudly, with the captured uvicorn output)
 * if the backend never becomes ready — e.g. port 8788 already bound by a
 * leftover process from a previous run. It does not swallow that failure
 * or retry silently.
 */
import { startShareBackend } from "./shareFixtures";

export default async function globalSetup(): Promise<void> {
  await startShareBackend();
}
