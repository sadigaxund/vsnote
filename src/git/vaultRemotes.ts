/**
 * Phase 17 Milestone C2 — pure logic for the mirror-remotes management
 * surface (Settings → Git & Sync, once the vault is initialized): remote
 * URL validation (client-side pre-flight, mirroring the server's exact
 * accepted-shapes contract so a user sees a specific error before ever
 * submitting) and status/outcome-to-message mapping (so
 * `VaultSetupPanel.tsx` renders one consistent one-row line/`Badge` tone
 * per state instead of re-deriving it inline). No React, no I/O — directly
 * unit-testable, same discipline as `git/remote.ts`'s
 * `validateRepoName`/`describeConnectionTest`.
 */
import type { MirrorRunStatus, RemoteCredentialKind, RemoteTestOutcome } from "../share/vaultApi";

/** Mirrors `server/app/mirror.py::validate_remote_url` closely enough to
 * catch the common mistakes client-side before a round trip: empty, a
 * leading `-` (argv-injection shape), a remote-helper transport
 * (`scheme::...`, most notoriously `ext::`), an unsupported scheme, a
 * scheme URL missing its host, or a host/user starting with `-`. Accepts
 * `https`/`http`/`ssh` with a real host, `file://...`, the scp-like
 * `user@host:path` form (`git@github.com:owner/repo.git`), and a plain
 * local path (`/...`, `./...`, `../...`) — the last one exists for local
 * testing, not a real deployment. THIS IS A PRE-FLIGHT CONVENIENCE ONLY:
 * the server re-validates independently and is the actual authority (a
 * 422 from `POST`/`PATCH /api/vault/remotes` is still possible and must
 * still be shown), so this function only needs to catch the common cases,
 * not be byte-for-byte identical to the Python implementation. */
export function validateMirrorRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return "Enter a remote URL.";
  if (trimmed.startsWith("-")) return "The URL must not start with a hyphen.";
  if (trimmed.includes("::")) return "Remote-helper transports like ext:: are not allowed.";

  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }

  if (parsed) {
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    if (!["https", "http", "ssh", "file"].includes(scheme)) {
      return `Unsupported URL scheme: ${scheme}.`;
    }
    if (scheme === "file") return null;
    if (!parsed.host) return "The URL is missing a host.";
    if (parsed.hostname.startsWith("-")) return "The host must not start with a hyphen.";
    return null;
  }

  // scp-like `user@host:path` (git's own alternate syntax, no scheme).
  const scpLike = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9_.-]*:[^-].*$/;
  if (scpLike.test(trimmed)) return null;

  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return null;

  return "Enter a valid https, http, ssh, scp-like, or local path URL.";
}

/** One-row, em-dash-free (DESIGN-SPEC round 4/28's permanent copy rule). */
export function validateMirrorRemoteName(name: string): string | null {
  if (!name.trim()) return "Enter a name for this remote.";
  return null;
}

/** Enforces the exact same required-field pairing the server does
 * (`routers/vault_remotes.py::create_remote`/`_apply_credential`): a
 * chosen credential kind needs its matching secret field non-blank. `null`
 * = valid (including `credential_kind === "none"`, which needs neither). */
export function validateCredentialFields(
  kind: RemoteCredentialKind,
  sshPrivateKey: string,
  httpsToken: string,
): string | null {
  if (kind === "ssh_key" && !sshPrivateKey.trim()) return "Paste the SSH private key.";
  if (kind === "https_token" && !httpsToken.trim()) return "Enter the access token.";
  return null;
}

export type StatusTone = "success" | "danger" | "warning" | "neutral";

/** `VaultRemoteOut.last_status`/`last_error` -> a Badge tone. `null`
 * (never run) reads as neutral, same as `"skipped"`. */
export function mirrorStatusTone(status: string | null | undefined): StatusTone {
  if (status === "success") return "success";
  if (status === "error") return "danger";
  if (status === "busy") return "warning";
  return "neutral";
}

/** One-row summary for a remote row's "last run" column, from `last_status`
 * + optional `last_error`/timestamp already formatted by the caller (this
 * function does no date math — `VaultSetupPanel.tsx` passes an
 * already-`toLocaleString`'d string, same as `SharedPanel.tsx`'s
 * `formatEpoch`). */
export function describeMirrorStatus(status: string | null | undefined, lastError: string | null | undefined): string {
  if (!status) return "Never run.";
  if (status === "success") return "Last mirror succeeded.";
  if (status === "busy") return "A mirror is already running.";
  if (status === "skipped") return "Skipped (disabled).";
  if (status === "error") return lastError ? `Last mirror failed: ${lastError}` : "Last mirror failed.";
  return status;
}

/** `MirrorRunOut.status` (the direct response of "Mirror now") -> a one-row
 * toast/inline message, distinct from `describeMirrorStatus` above (which
 * describes the remote's STORED last-run state, not a just-completed run's
 * own response). */
export function describeMirrorRunResult(status: MirrorRunStatus, message: string): string {
  if (status === "success") return "Mirrored successfully.";
  if (status === "busy") return "A mirror to this remote is already running.";
  if (status === "skipped") return "Skipped (this remote is disabled).";
  return message || "Mirror failed.";
}

export function remoteTestTone(outcome: RemoteTestOutcome): StatusTone {
  if (outcome === "reachable") return "success";
  if (outcome === "repo-missing") return "warning";
  return "danger";
}
