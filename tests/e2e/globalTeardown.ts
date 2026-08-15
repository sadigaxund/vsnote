/**
 * Playwright `globalTeardown` (wired in `playwright.config.ts`) — stops the
 * single share backend `globalSetup.ts` started, after every spec file has
 * finished. Runs in a fresh Node process (no memory of `globalSetup.ts`'s
 * in-process state), so `stopShareBackend()` falls back to the PID/temp-DB
 * path recorded on disk by `startShareBackend()` — see `shareFixtures.ts`.
 * Kills exactly that one PID, never a broad `pkill`/`killall`.
 */
import { stopShareBackend } from "./shareFixtures";

export default async function globalTeardown(): Promise<void> {
  await stopShareBackend();
}
