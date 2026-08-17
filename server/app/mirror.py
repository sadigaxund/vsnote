"""Phase 17 Milestone B — mirrors the authoritative vault's current branch
tip to external git remotes (GitHub/GitLab/Gitea/any), over SSH or HTTPS,
with credentials living SERVER-SIDE ONLY (`app/secrets_store.py`). Browsers
never speak SSH and never hold one of these credentials; they only ever talk
smart-HTTP to this server's own `/git/*` (see `routers/git_http.py`). This
module is the thing that then, separately, pushes onward from here.

**Engine choice: the system `git` binary via `subprocess`, not dulwich.**
Dulwich (already used throughout this codebase for the vault/`/git/*`
surface) has no real SSH transport — its `dulwich.client.SSHVendor`
machinery either shells out to `ssh`/`paramiko` in ways that are far less
battle-tested for arbitrary third-party remotes (GitHub/GitLab/Gitea host
key quirks, HTTP auth negotiation variants, protocol v2 details) than the
actual `git` CLI, which every one of those hosts is tested against by
millions of real pushes daily. Since the credentials here are the SAME
private key material `ssh` itself understands (`-i`, `GIT_SSH_COMMAND`) and
the SAME kind of HTTPS token any git host's docs describe, shelling out to
real `git`/`ssh` gets us that battle-tested interop for free instead of
reimplementing it. The only cost is depending on `git`/`openssh-client`
being present in the runtime image (see Dockerfile) — already true for
`git` (the smart-HTTP dependency `dulwich` doesn't need, but every dev
machine and the CI image already have it), and `openssh-client` is added
alongside it.

**Subprocess safety.** Every invocation uses a LIST argv (`subprocess.run`
with a `list[str]`, never `shell=True`, never a manually-interpolated
string) — the remote URL is one argv element, never concatenated into a
shell command line. `validate_remote_url()` additionally rejects anything
that could be mistaken for a flag (`-` prefix) or a git "remote helper"
transport (`scheme::`, most notoriously `ext::`, which executes an
arbitrary shell command as part of git's own protocol — see
`git-remote-ext(1)`) before a URL is ever accepted from the API or handed to
`git`. Every call also has a hard timeout (`subprocess.run(..., timeout=…)`)
so a hung remote can never hang a request or the app.

**Never force-push, anywhere, ever (roadmap §5.2, binding).** The one and
only push invocation this module ever runs is
`git push <url> <branch>:<branch>` — an explicit, non-`+`-prefixed refspec,
no `--force`, no `--force-with-lease`, no `--mirror` (which implies force
on every ref), no `+refspec`. A remote that has diverged (a real
non-fast-forward) is rejected by the REMOTE's own git, exactly as it would
reject any other ordinary contributor's non-force push — this module treats
that as an ordinary failure outcome (`MirrorOutcome(status="error", ...)`),
records it, and never retries with force. See
`tests/test_vault_mirror.py::test_diverged_remote_is_rejected_and_history_
is_not_rewritten` for the property proof.

**Credentials never touch argv, a response, or a log line.** SSH:
`GIT_SSH_COMMAND` carries only a filesystem path to the key
(`-i <keyfile>`), never the key material itself, plus
`-o BatchMode=yes` (fail fast instead of ever prompting) and
`-o StrictHostKeyChecking=accept-new` against a dedicated
`known_hosts` file under `VSNOTE_SECRETS_PATH` (trust-on-first-use, pinned
thereafter — a changed host key is refused, same as any normal
`~/.ssh/known_hosts`). HTTPS: the token is handed to `git` via
`GIT_ASKPASS` pointing at a tiny reusable script that reads it back out of
a `VSNOTE_MIRROR_TOKEN` environment variable this module sets ONLY for that
one subprocess call — the URL itself is NEVER built as
`https://<token>@host/...` (that would land the token in argv, in this
process's own `ps` output, and in any error message that echoes the URL).
`MirrorRunner`/`run_mirror`/`test_remote` below additionally redact any
known token value out of `git`'s stderr before it's ever stored
(`VaultRemote.last_error`) or written to an audit row, belt-and-suspenders
on top of `git`/the askpass protocol never echoing it in normal operation.

**Concurrency.** `MirrorRunner` holds one `threading.Lock` per remote id —
`run_one()` for a remote that's already mirroring returns immediately with
`status="busy"` rather than queuing or running a second push concurrently
against the same remote. A push-triggered mirror
(`trigger_push_on_receive()`, called from `routers/git_http.py` after a
successful receive-pack against the vault) runs in a background daemon
thread by default so it never delays the git push's own HTTP response;
`MirrorRunner.sync = True` (set by tests, never by `main.py`) makes it run
inline instead, so tests can assert on the outcome deterministically
without sleeping/polling for a background thread.
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlsplit

from . import models, secrets_store, vault
from .audit import write_audit_event
from .config import Settings

MIRROR_PUSH_TIMEOUT_SECONDS = 30
MIRROR_TEST_TIMEOUT_SECONDS = 15

# Never advertise "vsn_" tokens (or anything else identifying this app) in a
# credential store's error text — not applicable here, this module never
# generates the credential, only stores/uses what the owner supplied.

_ALLOWED_SCHEMES = {"https", "http", "ssh", "file"}

# git's own alternate "scp-like" remote syntax: user@host:path, no scheme.
# Host and user must not start with '-' (see validate_remote_url's docstring
# for the URL-injection class this defends against) or with a digit-only...
# no, digits are fine; just not '-'.
_SCP_LIKE_RE = re.compile(
    r"^(?P<user>[A-Za-z0-9_.][A-Za-z0-9_.-]*)@(?P<host>[A-Za-z0-9][A-Za-z0-9_.-]*):(?P<path>[^-].*)$"
)


class InvalidRemoteURL(ValueError):
    """Raised by `validate_remote_url` for anything that fails the scheme
    allowlist, looks like a flag, or looks like a git remote-helper
    transport. Callers turn this into a 422, never a stack trace."""


def validate_remote_url(url: str) -> None:
    """A remote URL is USER INPUT that becomes a real `git`/`ssh` argv
    element (`app/mirror.py`'s only two subprocess call sites both pass it
    through untouched, one list element). Reject, before it is ever stored
    or handed to a subprocess:

    - Empty/blank.
    - Anything starting with `-` — the classic argv-injection shape
      (`--upload-pack=...`, `--force`, ...): with a LIST argv this can't
      actually inject a SEPARATE flag (there is no shell re-parsing a
      string), but a value here could still be misread as an option BY
      `git` ITSELF (git's own arg parser doesn't distinguish "this came
      from a URL field" from "this came right after `git push` on a real
      command line") — rejecting it outright is the simple, unconditionally
      correct rule.
    - Any git remote-HELPER transport (`scheme::...`), because `ext::`
      specifically executes an arbitrary shell command as part of git's own
      protocol (`git-remote-ext(1)`) — this blocks that whole class rather
      than trying to enumerate every dangerous helper name.
    - A scheme outside `{https, http, ssh, file}`.
    - A host/user component (`https://`/`ssh://` netloc, or the scp-like
      `user@host:path` form's `user`/`host`) starting with `-` — a REAL,
      documented class of vulnerability (the same shape as the historical
      git/ssh `ProxyCommand`-via-URL issue): git's own URL parser extracts
      the host from an `ssh://` URL and then builds a real `ssh <host> ...`
      command line internally, so a host string starting with `-` can be
      misread by `ssh` as another flag, not a hostname.

    Accepted, alongside `https`/`http`/`ssh` with a real host: the scp-like
    `user@host:path` form (git's own alternate syntax, no scheme — what
    `git@github.com:owner/repo.git` looks like), `file://...`, and a plain
    local filesystem path (absolute or `./`/`../`-relative) — the last one
    exists for tests and for a local bare-repo mirror target, not something
    a real deployment is expected to use for GitHub/GitLab/Gitea.
    """
    if not url or not url.strip():
        raise InvalidRemoteURL("remote url must not be empty")
    if url.startswith("-"):
        raise InvalidRemoteURL("remote url must not start with '-'")
    if "::" in url:
        raise InvalidRemoteURL("remote url must not use a git remote-helper transport")

    parsed = urlsplit(url)
    if parsed.scheme:
        scheme = parsed.scheme.lower()
        if scheme not in _ALLOWED_SCHEMES:
            raise InvalidRemoteURL(f"unsupported url scheme: {parsed.scheme!r}")
        if scheme == "file":
            return
        if not parsed.netloc:
            raise InvalidRemoteURL("remote url is missing a host")
        netloc = parsed.netloc
        if "@" in netloc:
            netloc = netloc.rsplit("@", 1)[1]
        host = netloc.split(":")[0]
        if not host or host.startswith("-"):
            raise InvalidRemoteURL("remote url host must not start with '-'")
        return

    match = _SCP_LIKE_RE.match(url)
    if match:
        return

    if url.startswith("/") or url.startswith("./") or url.startswith("../"):
        return

    raise InvalidRemoteURL(f"unrecognized remote url format: {url!r}")


def _base_env() -> dict:
    # Copies the real process environment (PATH, HOME, ... — needed for
    # `git`/`ssh` to even be found and for ssh's own config lookups) and
    # layers git-specific overrides on top. GIT_TERMINAL_PROMPT=0 makes a
    # remote that would otherwise interactively prompt (an unrecognized host
    # key without accept-new, a missing credential) fail immediately instead
    # of hanging — the subprocess `timeout=` is the second, redundant line
    # of defense against a genuinely hung remote.
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def _ssh_env(settings: Settings, remote: "models.VaultRemote") -> dict:
    env = _base_env()
    keyfile = secrets_store.ssh_key_path(settings, remote.id)
    known_hosts = secrets_store.known_hosts_path(settings)
    env["GIT_SSH_COMMAND"] = (
        f"ssh -i {shlex.quote(str(keyfile))} -o IdentitiesOnly=yes -o BatchMode=yes "
        f"-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile={shlex.quote(str(known_hosts))}"
    )
    return env


def _https_env(settings: Settings, remote: "models.VaultRemote") -> dict:
    """`GIT_ASKPASS` points at a reusable, secret-free script
    (`secrets_store.askpass_script_path`) that reads the actual token back
    out of `VSNOTE_MIRROR_TOKEN`, set here ONLY for this one subprocess call
    — never persisted, never logged, never part of the remote URL. Also
    blanks any configured system/global git credential helper for the
    duration of this one call (`GIT_CONFIG_*`, git's own env-based config
    override) so a stray cached credential on the HOST can never silently
    substitute for the one this remote is actually configured with."""
    env = _base_env()
    token = secrets_store.read_https_token(settings, remote.id)
    if token is not None:
        env["GIT_ASKPASS"] = str(secrets_store.askpass_script_path(settings))
        env["VSNOTE_MIRROR_TOKEN"] = token
        env["GIT_CONFIG_COUNT"] = "1"
        env["GIT_CONFIG_KEY_0"] = "credential.helper"
        env["GIT_CONFIG_VALUE_0"] = ""
    return env


def _env_for(settings: Settings, remote: "models.VaultRemote") -> dict:
    if remote.credential_kind == models.RemoteCredentialKind.ssh_key:
        return _ssh_env(settings, remote)
    if remote.credential_kind == models.RemoteCredentialKind.https_token:
        return _https_env(settings, remote)
    return _base_env()


def _redact(text: str, secret: Optional[str]) -> str:
    if secret and secret in text:
        return text.replace(secret, "[REDACTED]")
    return text


def _sanitize_message(settings: Settings, remote: "models.VaultRemote", text: str) -> str:
    """Belt-and-suspenders: `git`/the askpass protocol should never echo an
    HTTPS token into stderr/stdout in normal operation, but this redacts it
    anyway before the text is ever stored (`VaultRemote.last_error`) or
    written to an audit row — neither of those must EVER contain a secret,
    not even truncated."""
    message = (text or "").strip()
    if remote.credential_kind == models.RemoteCredentialKind.https_token:
        token = secrets_store.read_https_token(settings, remote.id)
        message = _redact(message, token)
    return message[:1000]


@dataclass
class MirrorOutcome:
    status: str  # "success" | "error" | "busy" | "skipped"
    message: str
    ts: float = field(default_factory=time.time)


def run_mirror(settings: Settings, remote: "models.VaultRemote") -> MirrorOutcome:
    """Pushes the vault's current branch tip to `remote.url`. Synchronous,
    blocking — callers that want this off the request path use
    `MirrorRunner` below, which handles backgrounding/locking; this
    function itself has no opinion about threading, only about running the
    push safely and reporting what happened."""
    if not remote.enabled:
        return MirrorOutcome(status="skipped", message="remote is disabled")

    try:
        validate_remote_url(remote.url)
    except InvalidRemoteURL as exc:
        return MirrorOutcome(status="error", message=f"invalid remote url: {exc}")

    desc = vault.describe_vault(settings)
    if not desc.initialized or not desc.has_commits or not desc.head_branch:
        return MirrorOutcome(status="error", message="vault has no commits to mirror yet")

    vault_path = vault.vault_repo_path(settings)
    branch = desc.head_branch
    argv = ["git", "push", remote.url, f"{branch}:{branch}"]
    env = _env_for(settings, remote)
    try:
        proc = subprocess.run(
            argv,
            cwd=str(vault_path),
            env=env,
            capture_output=True,
            text=True,
            timeout=MIRROR_PUSH_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return MirrorOutcome(status="error", message="mirror push timed out")
    except OSError as exc:
        return MirrorOutcome(status="error", message=f"failed to start git: {exc}")

    if proc.returncode == 0:
        return MirrorOutcome(status="success", message=f"pushed {branch}")
    message = _sanitize_message(settings, remote, proc.stderr or proc.stdout or f"git push exited {proc.returncode}")
    return MirrorOutcome(status="error", message=message or f"git push exited {proc.returncode}")


@dataclass
class RemoteTestResult:
    outcome: str  # "reachable" | "auth-rejected" | "repo-missing" | "unreachable" | "error"
    message: str


_UNREACHABLE_MARKERS = (
    "could not resolve host",
    "connection refused",
    "connection timed out",
    "network is unreachable",
    "could not connect",
    "couldn't connect to server",
    "failed to connect",
    "no route to host",
    "operation timed out",
)
_AUTH_REJECTED_MARKERS = (
    "permission denied",
    "authentication failed",
    "invalid username or password",
    "access denied",
    "could not read username",
    "could not read password",
    "bad credentials",
)
_REPO_MISSING_MARKERS = (
    "repository not found",
    "does not appear to be a git repository",
    "could not read from remote repository",
    "does not exist",
    "not found",
)


def classify_ls_remote_failure(stderr_text: str) -> str:
    """Pure classification of a failed `git ls-remote`'s stderr into one of
    the three-plus-one outcome buckets the phase brief asks for (mirrors
    `src/git/remote.ts::describeConnectionTest`'s split, applied here to an
    external mirror target instead of the in-app sync remote): unreachable /
    auth-rejected / repo-missing / error. Factored out from `test_remote` so
    the classification rules themselves are unit-testable against synthetic
    git error text without needing a real unreachable/auth-rejecting
    remote."""
    lowered = (stderr_text or "").lower()
    if any(marker in lowered for marker in _UNREACHABLE_MARKERS):
        return "unreachable"
    if any(marker in lowered for marker in _AUTH_REJECTED_MARKERS):
        return "auth-rejected"
    if any(marker in lowered for marker in _REPO_MISSING_MARKERS):
        return "repo-missing"
    return "error"


def test_remote(settings: Settings, remote: "models.VaultRemote") -> RemoteTestResult:
    """`git ls-remote <url>` — read-only, never mutates the remote.
    Classifies the outcome via `classify_ls_remote_failure` above (plus the
    success case, "reachable")."""
    try:
        validate_remote_url(remote.url)
    except InvalidRemoteURL as exc:
        return RemoteTestResult(outcome="error", message=f"invalid remote url: {exc}")

    argv = ["git", "ls-remote", remote.url]
    env = _env_for(settings, remote)
    try:
        proc = subprocess.run(
            argv, env=env, capture_output=True, text=True, timeout=MIRROR_TEST_TIMEOUT_SECONDS
        )
    except subprocess.TimeoutExpired:
        return RemoteTestResult(outcome="unreachable", message="timed out reaching the remote host")
    except OSError as exc:
        return RemoteTestResult(outcome="error", message=f"failed to start git: {exc}")

    if proc.returncode == 0:
        return RemoteTestResult(outcome="reachable", message="reachable, authenticated, and the repository exists")

    text = _sanitize_message(settings, remote, proc.stderr or proc.stdout or "")
    outcome = classify_ls_remote_failure(text)
    messages = {
        "unreachable": "could not reach the remote host",
        "auth-rejected": "reached the host, but the credential was rejected",
        "repo-missing": "authenticated, but the repository does not exist",
        "error": text or f"git ls-remote exited {proc.returncode}",
    }
    return RemoteTestResult(outcome=outcome, message=messages[outcome])


class MirrorRunner:
    """Coordinates mirror runs for one app instance (one `Settings` + one
    `session_local`, mirroring the rest of this codebase's "no shared
    global state between app instances" posture — see `main.py::create_app`).

    `sync` (default `False`): production behavior for `trigger_push_on_
    receive()` spawns a background daemon thread per enabled/push-on-receive
    remote so a slow/hung remote never delays the git push's own HTTP
    response (roadmap: mirroring "must NOT block or slow the push
    response"). Tests set `mirror_runner.sync = True` (see
    `tests/test_vault_mirror.py`) to run every triggered mirror inline
    instead, so the outcome can be asserted on deterministically without
    sleeping/polling for a background thread to finish.

    One remote's mirror never runs twice concurrently: `run_one()` takes a
    per-remote-id `threading.Lock`; a call that finds it already held
    returns immediately with `status="busy"` rather than queuing or racing
    a second push against the same remote.
    """

    def __init__(self, session_local, settings: Settings) -> None:
        self.session_local = session_local
        self.settings = settings
        self.sync = False
        self._locks: dict[int, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _lock_for(self, remote_id: int) -> threading.Lock:
        with self._locks_guard:
            lock = self._locks.get(remote_id)
            if lock is None:
                lock = threading.Lock()
                self._locks[remote_id] = lock
            return lock

    def run_one(self, remote_id: int, *, principal: Optional[str] = None) -> MirrorOutcome:
        """Runs (or reports "busy" for) one remote's mirror, synchronously,
        and records the outcome on the `VaultRemote` row plus an audit
        event (skipped for "busy"/"skipped" — those are not real mirror
        attempts). `principal` is the acting identity for the audit row: the
        owner's principal for an explicit `POST .../mirror`, `None` for a
        push-triggered run (there is no interactive caller)."""
        lock = self._lock_for(remote_id)
        if not lock.acquire(blocking=False):
            return MirrorOutcome(status="busy", message="a mirror run for this remote is already in progress")
        try:
            db = self.session_local()
            try:
                remote = db.get(models.VaultRemote, remote_id)
                if remote is None:
                    return MirrorOutcome(status="error", message="remote not found")
                outcome = run_mirror(self.settings, remote)
                if outcome.status in ("success", "error"):
                    remote.last_mirror_at = outcome.ts
                    remote.last_status = outcome.status
                    remote.last_error = None if outcome.status == "success" else outcome.message
                    remote.updated_at = time.time()
                    db.commit()
                    event = "vault_remote.mirror_success" if outcome.status == "success" else "vault_remote.mirror_failure"
                    write_audit_event(
                        db,
                        event,
                        principal=principal,
                        reason=f"remote={remote.name}: {outcome.message}"[:255],
                    )
                return outcome
            finally:
                db.close()
        finally:
            lock.release()

    def trigger_push_on_receive(self) -> None:
        """Called from `routers/git_http.py`'s `GitAuthMiddleware` right
        after a successful `git-receive-pack` against the vault repo — see
        that module's docstring for exactly where. Fires every enabled,
        `push_on_receive=True` remote; each one runs in its own background
        thread (or inline, if `self.sync`) so remotes never serialize
        behind one another and never delay the push response that already
        completed by the time this is called."""
        db = self.session_local()
        try:
            remote_ids = [
                row.id
                for row in db.query(models.VaultRemote)
                .filter_by(enabled=True, push_on_receive=True)
                .all()
            ]
        finally:
            db.close()

        for remote_id in remote_ids:
            if self.sync:
                self.run_one(remote_id)
            else:
                threading.Thread(target=self.run_one, args=(remote_id,), daemon=True).start()
