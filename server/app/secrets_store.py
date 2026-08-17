"""Server-side-only credential storage for Phase 17 Milestone B's
external-remote mirroring (`app/mirror.py`). Nothing in this module is ever
reachable from the browser: it is used exclusively by
`routers/vault_remotes.py` (write-only — set/replace/clear, never read back
into a response) and `app/mirror.py` (reads the material to hand to a `git`
subprocess's environment, never into a response body or a log line).

**Both credential kinds use this SAME file-based mechanism, not a DB
column.** An SSH private key has no other home — it must be a real file on
disk for `ssh -i <file>` (via `GIT_SSH_COMMAND`) to read it at all, so that
half of the choice is forced. For HTTPS tokens, storing them in a DB column
"no schema ever serializes" was the other option the phase brief offered;
this module picks the file instead, for symmetry: one mechanism, one set of
permission guarantees (0600 in a 0700 directory), one deletion path
(`delete_credential_files`, called from both `DELETE /api/vault/remotes/{id}`
and every credential replace/clear), one thing to audit for "does this leak
a secret" rather than two. It also means a full SQLite DB file — copied for
backup, attached to a bug report, whatever — can never itself contain a
mirror credential; only a targeted read of `VSNOTE_SECRETS_PATH` can.

**Permissions.** `ensure_secrets_root()` creates the root directory with
mode 0700 on first use (`os.chmod` after `mkdir`, not relying on umask
alone). Every credential file is written via `_write_secret_file()`, which
opens with `os.O_CREAT | os.O_TRUNC | os.O_WRONLY` and an explicit `0o600`
mode at creation time, then `os.chmod`s it again after writing — belt and
suspenders against a loose process umask ever leaving the file briefly
group/world-readable. Deleting a `VaultRemote` (or clearing/replacing its
credential) deletes the file(s) here too — nothing outlives its DB row.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Optional

from .config import Settings

ASKPASS_SCRIPT_NAME = "git-askpass.sh"
KNOWN_HOSTS_NAME = "known_hosts"

# Best-effort only — see compute_ssh_fingerprint's docstring for why a
# failure here never blocks accepting a key.
_SSH_KEYGEN_TIMEOUT_SECONDS = 5


def secrets_root(settings: Settings) -> Path:
    return Path(settings.secrets_path)


def ensure_secrets_root(settings: Settings) -> Path:
    root = secrets_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    return root


def known_hosts_path(settings: Settings) -> Path:
    """A single, shared `known_hosts` file for every SSH remote this server
    mirrors to (`GIT_SSH_COMMAND`'s `-o UserKnownHostsFile=...`, combined
    with `-o StrictHostKeyChecking=accept-new` — the phase brief's exact
    contract: a never-before-seen host key is trusted-on-first-use and
    pinned here, a CHANGED one is refused by `ssh` itself, same as any
    normal `~/.ssh/known_hosts` would behave). Created empty (0600) on first
    use; `ssh` appends to it itself as new hosts are accepted."""
    root = ensure_secrets_root(settings)
    path = root / KNOWN_HOSTS_NAME
    if not path.exists():
        path.touch()
        os.chmod(path, 0o600)
    return path


def _write_secret_file(path: Path, content: str, *, mode: int = 0o600) -> None:
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
    finally:
        os.chmod(path, mode)


def ssh_key_path(settings: Settings, remote_id: int) -> Path:
    return secrets_root(settings) / f"remote-{remote_id}.key"


def https_token_path(settings: Settings, remote_id: int) -> Path:
    return secrets_root(settings) / f"remote-{remote_id}.token"


def askpass_script_path(settings: Settings) -> Path:
    """One shared, reusable helper script — see `app/mirror.py`'s
    `_https_env` docstring for how it's used. The script itself never
    contains a secret (it only reads one from the environment at the
    moment `git` invokes it), so 0700-owner-only-executable is sufficient;
    it is regenerated if missing, never overwritten once present (nothing
    about its content is ever remote-specific)."""
    root = ensure_secrets_root(settings)
    path = root / ASKPASS_SCRIPT_NAME
    if not path.exists():
        _write_secret_file(path, "#!/bin/sh\nprintf '%s' \"$VSNOTE_MIRROR_TOKEN\"\n", mode=0o700)
    return path


def set_ssh_key(settings: Settings, remote_id: int, private_key_pem: str) -> Path:
    ensure_secrets_root(settings)
    path = ssh_key_path(settings, remote_id)
    # Some key parsers are picky about a missing final newline.
    text = private_key_pem if private_key_pem.endswith("\n") else private_key_pem + "\n"
    _write_secret_file(path, text)
    return path


def set_https_token(settings: Settings, remote_id: int, token: str) -> Path:
    ensure_secrets_root(settings)
    path = https_token_path(settings, remote_id)
    _write_secret_file(path, token)
    return path


def read_https_token(settings: Settings, remote_id: int) -> Optional[str]:
    path = https_token_path(settings, remote_id)
    if not path.exists():
        return None
    return path.read_text()


def delete_ssh_key_only(settings: Settings, remote_id: int) -> None:
    try:
        ssh_key_path(settings, remote_id).unlink()
    except FileNotFoundError:
        pass


def delete_https_token_only(settings: Settings, remote_id: int) -> None:
    try:
        https_token_path(settings, remote_id).unlink()
    except FileNotFoundError:
        pass


def delete_credential_files(settings: Settings, remote_id: int) -> None:
    """Called from `DELETE /api/vault/remotes/{id}` and from a PATCH that
    clears or replaces a credential — a stale file for a credential kind
    the remote no longer uses must never survive on disk."""
    delete_ssh_key_only(settings, remote_id)
    delete_https_token_only(settings, remote_id)


def compute_ssh_fingerprint(path: Path) -> Optional[str]:
    """Best-effort SHA256 fingerprint via the system `ssh-keygen -lf`
    (works directly against a private key file, no separate public-key
    extraction step needed) — display-only
    (`VaultRemote.credential_fingerprint`), never the key material itself.
    Returns `None` if `ssh-keygen` can't parse the file or isn't installed:
    the fingerprint is a convenience for the owner to recognize which key
    is configured, not a validity gate — real validity is proven the first
    time `ssh` actually uses the key against the real remote, not guessed
    here."""
    try:
        proc = subprocess.run(
            ["ssh-keygen", "-lf", str(path)],
            capture_output=True,
            text=True,
            timeout=_SSH_KEYGEN_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    line = proc.stdout.strip()
    return line or None
