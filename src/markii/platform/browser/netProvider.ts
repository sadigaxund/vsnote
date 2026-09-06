/**
 * Phase M3 — the browser `NetProvider` (`@markii/lua`'s shape, re-exported
 * by `src/markii/host/types.ts`): the actual `window.fetch` call a script's
 * `net.get`/`net.post`/`net.patch` capability bottoms out at, once
 * `capabilities.ts` has decided a given run is even allowed to have one
 * wired up at all.
 *
 * This module does no allowlisting of its own — `@markii/lua`'s
 * `buildCapabilities` already checks a URL's hostname against the
 * `netGrants` this host supplies before ever calling `get`/`post`/`patch`
 * here, and `capabilities.ts` is what decides what that grants object
 * contains per tier. This is deliberately a thin, policy-free transport: it
 * exists only so `host/` never imports `window`/`fetch` directly (this file
 * is the one place in the browser platform that does).
 *
 * Runs on the MAIN thread, not inside the script Worker: `@markii/lua`'s
 * `NetProvider` is a pair of async functions, which cannot be
 * structured-cloned across `postMessage`. `platform/browser/scriptIsolate.ts`
 * bridges this via a small RPC over the worker's message channel — see that
 * module's doc comment for the full wiring.
 */
import type { NetProvider } from "@markii/lua";

async function toNetResponse(response: Response): Promise<{ status: number; body: string }> {
  return { status: response.status, body: await response.text() };
}

/** A `NetProvider` backed by the real `window.fetch`. */
export function createBrowserNetProvider(): NetProvider {
  return {
    async get(url) {
      const response = await fetch(url, { method: "GET" });
      return toNetResponse(response);
    },
    async post(url, body) {
      const response = await fetch(url, { method: "POST", body });
      return toNetResponse(response);
    },
    async patch(url, body) {
      const response = await fetch(url, { method: "PATCH", body });
      return toNetResponse(response);
    },
  };
}
