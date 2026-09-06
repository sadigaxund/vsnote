/**
 * Pure logic behind `GrantPromptDialog` (Phase M3, worker 3), extracted the
 * same way `publishDialogLogic.ts` was pulled out of `PublishDialog` — so
 * the "what does this dialog actually show" question is unit-testable
 * without mounting React or a `my-you-eye` `Dialog`.
 *
 * `GrantPromptRequest` (`src/markii/host/types.ts`) carries only `scripts`
 * — a note's script blocks never DECLARE the hosts they intend to reach
 * (there is no manifest field for it), so there is nothing to read a
 * requested-hosts list off of directly. `scanScriptRequests` recovers a
 * best-effort list anyway, by the SAME lightweight-source-scan discipline
 * `src/markii/host/packs.ts`'s `referencedPackNamespaces` already uses for
 * `require` targets: a regex over the script's Lua source, not a real Lua
 * parse. A dynamically-built URL (`net.fetch_json(base .. path)`) is
 * invisible to this scan — the dialog then simply shows no detected hosts
 * for that script, which is honest (nothing here CLAIMS completeness) but
 * worth calling out: this is presentation only, never a security boundary.
 * The actual grant enforcement (`host/capabilities.ts`) trusts only what
 * the user explicitly ticks in the dialog, not this scan's output.
 */
import type { ScriptBlock } from "@markii/core";
import type { GrantedPermissions } from "../../markii/host/types";

export interface ScanResult {
  /** Hostnames found in a `net.fetch_json`/`net.get` call — read-only network access. */
  getHosts: string[];
  /** Hostnames found in a `net.post`/`net.patch` call — effectful network access. */
  postHosts: string[];
  /** Whether any script's source calls `bundle.write`. */
  bundleWriteRequested: boolean;
}

const GET_CALL = /net\s*\.\s*(?:fetch_json|get)\s*\(\s*(['"])(https?:\/\/[^'"]+)\1/g;
const POST_CALL = /net\s*\.\s*(?:post|patch)\s*\(\s*(['"])(https?:\/\/[^'"]+)\1/g;
const BUNDLE_WRITE_CALL = /bundle\s*\.\s*write\s*\(/;

function hostOf(literal: string): string | undefined {
  try {
    return new URL(literal).host;
  } catch {
    return undefined;
  }
}

function extractHosts(code: string, pattern: RegExp): string[] {
  const hosts = new Set<string>();
  for (const match of code.matchAll(pattern)) {
    const host = hostOf(match[2]!);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/** Best-effort scan of every script's source for the network hosts and bundle-write calls it appears to make — see this module's doc for why this can never be exhaustive. */
export function scanScriptRequests(scripts: readonly ScriptBlock[]): ScanResult {
  const getHosts = new Set<string>();
  const postHosts = new Set<string>();
  let bundleWriteRequested = false;

  for (const script of scripts) {
    for (const host of extractHosts(script.code, GET_CALL)) getHosts.add(host);
    for (const host of extractHosts(script.code, POST_CALL)) postHosts.add(host);
    if (BUNDLE_WRITE_CALL.test(script.code)) bundleWriteRequested = true;
  }

  return { getHosts: [...getHosts].sort(), postHosts: [...postHosts].sort(), bundleWriteRequested };
}

/** Builds the `GrantedPermissions` a dialog's "Allow" click produces from whichever hosts/bundle-write toggle the user left checked. */
export function permissionsFromSelection(
  selectedGet: readonly string[],
  selectedPost: readonly string[],
  bundleWrite: boolean,
): GrantedPermissions {
  return { net: { get: [...selectedGet], post: [...selectedPost] }, bundleWrite };
}
