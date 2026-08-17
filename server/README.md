# VSNote backend (Phase 9 + Phase 10.5a + Phase 11)

FastAPI + SQLite backend providing sharing, auth (Phase 9), and real git sync
(Phase 11) for the VSNote SPA — and, as of Phase 10.5a's single-origin
refactor (`../docs/ROADMAP-SHARING-AUTH.md` §5.4), the SPA's own web server.
Spec: `../docs/ROADMAP-SHARING-AUTH.md` (the security posture in §1 is
binding) and `../docs/IMPLEMENTATION-PLAN-V2.md`'s "Phase 9"/"Phase
10.5"/"Phase 11" sections. See `../docs/ARCHITECTURE.md`'s "Backend (v2)",
"Single-origin deployment (Phase 10.5a)", and "Real sync (Phase 11)"
sections for how this maps onto the rest of the project's docs.

The SPA (`src/`) must remain fully usable with this backend down IF it's
already loaded or PWA-installed — see CLAUDE.md rule 3 (amended for Phase
10.5a: since this process is now also the SPA's web server, a *cold*
uncached load genuinely needs it running; share/sync affordances always
degrade gracefully, and the SPA bundle itself never requires the API to
boot, render, or edit). `npm run dev`/`npm run build` never need this
directory.

## Running it

```sh
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
cp server/.env.example server/.env   # optional — sane defaults without it
npm run build                         # from the repo root — builds dist/ for this server to serve
npm run server                        # from the repo root
```

`npm run server` runs:

```sh
server/.venv/bin/python -m uvicorn app.main:app --reload --port 8787 --app-dir server \
  --proxy-headers --forwarded-allow-ips='*'
```

`--proxy-headers --forwarded-allow-ips='*'` (Phase 10.5a, roadmap §5.4):
trusts `X-Forwarded-Proto`/`X-Forwarded-Host` from whatever's in front of
this process (any HTTPS reverse proxy or tunnel, in the intended deployment
— see "Single-origin deployment" below) so anything this app ever derives from the
request's scheme/host reflects the real external `https://` origin, not
`http://127.0.0.1:8787`. `forwarded-allow-ips='*'` (rather than uvicorn's
default, which only trusts `127.0.0.1`) is a deliberate, local-single-host
choice: a tunnel client can connect from a container/bridge IP that isn't
literally `127.0.0.1` depending on how it's run, and this process has no
other untrusted network path in front of it to worry about spoofing from.

Serves three things from one process/port, single-origin:
- `/api/*`, `/share/*`, `/git/*` — the JSON/policy/git APIs (unchanged
  contracts, see below).
- Everything else — the built SPA (`../dist/`, i.e. `npm run build`'s
  output): static assets at their real paths, an SPA fallback to
  `index.html` for anything else GET, `text/html`. Missing `dist/` (no
  build yet) degrades to a one-line startup log + a plain 404 there, never a
  crash — the API surfaces stay fully usable regardless (see `main.py`'s
  "Single-origin SPA serving" doc for the exact route-ordering argument for
  why this can never swallow an `/api/*`/`/share/*`/`/git/*` 404).

Interactive API docs: `http://127.0.0.1:8787/docs` (owner/`/api` routes only
— `/share/*` isn't a documented-schema surface on purpose, it's raw/JSON
content negotiation, see below).

## Docker (Phase 14)

The whole app (this backend + the built SPA, single-origin, one process) also
ships as one container. From the repo root:

```sh
cp .env.example .env   # edit VSNOTE_SECRET_KEY, VSNOTE_BOOTSTRAP_USER/PASSWORD, etc.
docker compose up -d --build
# → http://localhost:8787/  (or ${VSNOTE_HOST_PORT} if you changed it)
```

`Dockerfile` (repo root) is a two-stage build: a `node:20-slim` stage runs
`npm ci && npm run build`; the final `python:3.12-slim` stage installs
`requirements.txt` (filtered to drop the `pytest`/`httpx` test-only
entries — no test runner ships in the image), copies `server/app` +
`server/scripts` and the built `dist/`, and runs as a non-root user
(`vsnote`, uid/gid 1000) — never node, never a dev dependency, never root.
See `../docs/ARCHITECTURE.md`'s "Containerization (Phase 14)" section for
the full design (DIST_DIR path resolution, the healthcheck's reasoning,
the persistence contract) — not duplicated here to avoid the two drifting.

**Persistent state lives in two named volumes** (`docker-compose.yml`):
the SQLite DB (`VSNOTE_DB_URL` defaults to `sqlite:////data/db/vsnote.db` in
the container, not this file's local `./vsnote.db` default) and
`VSNOTE_GIT_ROOT` (defaults to `/data/git-repos` in the container). `docker
compose down` leaves both intact; `docker compose down -v` is the
deliberate factory reset (destroys the DB and every synced git repo).

**Bootstrap user from env** (see "Fallback-login onboarding" above) works
identically in the container — set `VSNOTE_BOOTSTRAP_USER`/
`VSNOTE_BOOTSTRAP_PASSWORD` in `.env` before first `up`. To reset a password
or add a second account later: `docker compose exec vsnote python
server/scripts/create_user.py`.

**Real git sync** (see "Real git sync" below) also works identically
against the container's `/git/{repo}.git` — a real `git clone`/`push`
against `http://<host>:<port>/git/vault.git` with an API token, from any
system `git` client, was used to verify this phase (not just the app's own
isomorphic-git client).

**Reverse proxy / tunnel**: any HTTPS reverse proxy or tunnel works in front
of this container — `--proxy-headers --forwarded-allow-ips='*'` (above)
means proxy headers are honored regardless of which one an operator runs.

## Running the tests

```sh
server/.venv/bin/python -m pytest server/tests -q
```

Every test builds its own fully isolated app (`tests/conftest.py`'s
`make_app`/`make_settings` fixtures) against a fresh `tmp_path` SQLite file —
no shared state, no network access (the Cf-Access JWKS fetch is stubbed via
`app.state.cf_jwks_fetcher.override`), no bound port.

## Config

Env-driven, see `.env.example` for the full annotated list (loaded from
`server/.env` if present). Highlights:

| Var | Default | Notes |
|---|---|---|
| `VSNOTE_DB_URL` | `sqlite:///./vsnote.db` | SQLAlchemy URL |
| `VSNOTE_SECRET_KEY` | *(none)* | **Required** when `VSNOTE_ENV=prod`; auto-generated ephemeral + loud warning in dev |
| `VSNOTE_PORT` | `8787` | reserved for this backend across the project — never 5173/5174/8000/5290 |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | *(unset)* | leaving these unset disables the Cf-Access path entirely (not an implicit allow) |
| `VSNOTE_MAX_BLOB_BYTES` | `5242880` (5 MiB) | `POST /api/blobs` and `PUT /share/{id}` both enforce this → 413 |
| `VSNOTE_RATE_LIMIT_DEFAULT` / `_SHARE` / `_SHARE_AUTH` | `120/minute` / `60/minute` / `5/minute` | slowapi limit strings; `_SHARE_AUTH` is the brute-force throttle on `POST /share/{id}/auth` and `POST /api/auth/login` |
| `VSNOTE_SESSION_TTL_MIN` | `30` | both the app session cookie and per-share password session cookie |
| `VSNOTE_COOKIE_SECURE` | `True` | set `False` only to test over plain `http://` locally |
| `VSNOTE_GIT_ROOT` | `./git-repos` | Phase 11 — where bare git repos live, `{root}/{repo}.git`, created on demand |
| `VSNOTE_BOOTSTRAP_USER` / `VSNOTE_BOOTSTRAP_PASSWORD` | *(unset)* | Phase 12 — creates that fallback-login user at startup, iff no `User` row exists yet. See "Fallback-login onboarding" below |
| `VSNOTE_VAULT_PATH` | *(unset)* | Phase 17 — mounts a real, non-bare, plaintext working tree at this path as the AUTHORITATIVE vault. Unset (default): no change from Phase 11 — the vault is just the ordinary bare repo below. See "Server-mounted vault" below |
| `VSNOTE_VAULT_REPO_NAME` | `vault` | Phase 17 — the repo name clients use in `<origin>/git/<name>.git` to reach the vault (whichever shape it is). Must match `gitrepo.REPO_NAME_RE`; validated at startup |

## Fallback-login onboarding (Phase 12, DESIGN-SPEC Amendments round 4 item 32)

Before this phase, nothing ever created a `User` row outside `scripts/demo.sh`'s
own inline bootstrap snippet — so the app-level username+password login
(`POST /api/auth/login`) was dead in any real deployment: there was no account
to log into, and no way to make one, without hand-editing the database.
Two ways to get a working account now, both hashing with the same argon2id
path (`app/security.py::hash_password` — never a second implementation):

**1. Startup env vars — first boot only.** Set `VSNOTE_BOOTSTRAP_USER` and
`VSNOTE_BOOTSTRAP_PASSWORD` (both, together) and start the server:

```sh
VSNOTE_BOOTSTRAP_USER=owner VSNOTE_BOOTSTRAP_PASSWORD='a real password' \
  npm run server
```

`app/main.py::bootstrap_user` runs once, right after the tables are created,
and creates that one admin user **iff the `users` table is completely
empty**. Every other case is a safe no-op:

- Neither var set: does nothing (the default — this feature is fully opt-in).
- Exactly one of the two set: fails LOUDLY at startup (`RuntimeError`,
  process never comes up) instead of silently creating a half-configured
  account with a missing username or password.
- The table already has at least one row, from ANY source (a previous
  bootstrap run, `demo.sh`, `create_user.py` below, or Cf-Access
  auto-provisioning) — bootstrap never overwrites an existing password and
  never creates a duplicate/second row. This makes it safe to leave the
  env vars set permanently (e.g. in a `.env` a deploy script always loads)
  without risking a password reset on every restart.
- The password is never written to a log, exception message, or any other
  output at any point in this path — only the username is logged, and only
  on the one path that actually creates a row.

Full contract + regression tests: `tests/test_bootstrap.py`.

**2. `scripts/create_user.py` — any time, interactive.** For every other
case (a second account, or resetting a forgotten password on an existing
deployment):

```sh
server/.venv/bin/python server/scripts/create_user.py
# Username: owner
# Password: [hidden]
# Confirm password: [hidden]
```

Prompts for a username, then a HIDDEN password (`getpass.getpass()` — no
terminal echo) typed twice with a mismatch re-prompt, and writes the same
argon2id hash straight into the same DB the running server uses
(`VSNOTE_DB_URL`/`server/.env`, identical resolution to the server's own).
Never accepts the password as a command-line argument (visible to other
local processes via `/proc`/`ps`, and lands in shell history) and never
echoes/logs it anywhere.

If the username already exists, the script REFUSES by default (prints an
error, exits nonzero) rather than silently changing an existing password —
pass `--force` to explicitly reset that user's password instead. `--admin`
(default) / `--no-admin` controls the new/reset user's admin flag.

The Publish dialog's signed-out state links to this section (one-row hint,
DESIGN-SPEC item 28: "No account yet? See server/README.md.").

## Real git sync (Phase 11)

`/git/{repo}.git/...` serves a completely ordinary bare git repo per name over
the git **smart-HTTP** protocol (`info/refs`, `git-upload-pack`,
`git-receive-pack`) — `git clone`/`push`/`fetch`/`pull` all work against it
with **any** git client, not just this app's isomorphic-git client. Built on
[dulwich](https://www.dulwich.io/) (`dulwich.web.HTTPGitApplication`, a WSGI
app) bridged into this app's ASGI stack with
[`a2wsgi`](https://github.com/abersheeran/a2wsgi) (the non-deprecated
replacement for `starlette.middleware.wsgi`, which the installed
starlette/fastapi version still has but flags as deprecated).

**Auth reuses the exact Phase 9 API tokens** (`security.hash_token`, the same
`ApiToken` table) — no second token system. Git clients speak HTTP Basic
(`Authorization: Basic base64(user:token)`, the token in either the password
or username slot — both are tried) or `Authorization: Bearer <token>`. Scope
enforcement: `read` (or higher) is enough for fetch/clone (`git-upload-pack`,
including the `info/refs?service=git-upload-pack` advertisement);
`write`/`share-admin` is required for push (`git-receive-pack` and its
advertisement) — a `read`-scoped token attempting to push gets `403`. No
token, or a token that doesn't resolve at all (unknown/revoked/expired), gets
`401` with `WWW-Authenticate: Basic realm="vsnote-git"` so real git clients
know to prompt/retry with credentials — this is a genuine auth challenge
surface, unlike `/share/*`'s deliberate uniform-404 no-oracle posture (roadmap
§1); the two are not the same kind of endpoint and are not held to the same
response-shape rule.

**Path safety**: the repo name is user input straight off the URL. It's
validated against `^[A-Za-z0-9_-]{1,64}$` (`app/gitrepo.py::REPO_NAME_RE`)
*before* ever being joined onto a filesystem path — that alone makes `..` and
`/` structurally unrepresentable in a valid name — plus a second check that
the resolved path is still inside `VSNOTE_GIT_ROOT`, in case `VSNOTE_GIT_ROOT`
itself is ever misconfigured. See `app/gitrepo.py`'s module docstring for why
this is a bespoke `Backend` rather than dulwich's own
`FileSystemBackend` (that class's `open_repository` silently ignores its own
`root` whenever the derived path is absolute — a real `os.path.join` quirk,
confirmed by hand against dulwich 1.2.12 before writing around it).

**Repos are created on demand** — bare, empty, HEAD pointed at this app's own
default branch name (`feat/incremental-index` — see `client.ts`'s
`DEFAULT_BRANCH`) — the first time an authorized WRITE request touches a name
that doesn't exist yet. A read-only request against a repo that was never
pushed to gets a normal
`404` (dulwich's own "no such repo" response) — nothing is auto-created for
reads.

**No CORS** on `/git/*` (Phase 10.5a, roadmap §5.4) — same as `/api` and
`/share/*`. The browser's own isomorphic-git client now talks to this
same-origin (the sync remote is implicitly `<origin>/git/vault.git`), so it
never needs a cross-origin preflight; external git clients (system `git`,
scripts) were never same-origin browser `fetch()` calls in the first place
and never needed CORS headers to read a response.

**Fast-forward-only is enforced client-side**, not here: this server has no
opinion about non-fast-forward pushes at the protocol level (plain dulwich
`receive-pack` doesn't reject them the way e.g. GitHub's `receive.
denyNonFastforwards` policy would). The VSNote client (`src/git/remote.ts`)
refuses to attempt a push at all once it detects local/remote have diverged —
see `docs/ARCHITECTURE.md`'s "Real sync (Phase 11)" section for the exact
policy and how it's surfaced in the UI.

## Server-mounted vault (Phase 17 Milestone A)

By default (`VSNOTE_VAULT_PATH` unset), the vault is just the ordinary bare
repo at `{VSNOTE_GIT_ROOT}/{VSNOTE_VAULT_REPO_NAME}.git` — nothing here
changes from "Real git sync" above. Setting `VSNOTE_VAULT_PATH` to a
filesystem path makes that path the AUTHORITATIVE vault instead: a real,
non-bare git working tree the server keeps in sync with pushes, readable
and editable directly by anything with filesystem access to the path (a
text editor over SSH, `git clone` from the host, ...) — not just a git
object store other clients push bytes into. The vault stays PLAINTEXT
always, in both shapes; never encrypted at rest.

**Mounting it (docker compose):**

```yaml
    environment:
      VSNOTE_VAULT_PATH: /data/vault
      VSNOTE_VAULT_REPO_NAME: vault   # default — only change if you also
                                       # change the client's "Repository name"
    volumes:
      - vsnote-vault:/data/vault
```

(the checked-in `docker-compose.yml` already wires this in, commented, next
to the existing `vsnote-git-repos` volume — uncomment it to opt in). For a
host path instead of a named volume, bind-mount it:

```yaml
    volumes:
      - /srv/my-notes:/data/vault
```

**First boot with an empty mount**: nothing is auto-created. Log in and
call `POST /api/vault/init` (session-authenticated, no request body
required — an optional `{"branch": "..."}` picks the branch name, default
matches the client's own default branch) exactly once. Every git request
against an uninitialized mounted vault is refused until then — reads get a
plain `404`, writes get `409` with a one-line body explaining why — nothing
is ever silently auto-created for this one repo name the way legacy repo
names still are.

**An existing `.git` is always respected.** If the mount already contains a
real git repository — the owner set one up by hand, or a previous
deployment's data — `POST /api/vault/init` refuses (`409`) rather than
touching it in any way, and the git-http surface serves it exactly as if
VSNote had initialized it itself. Nothing in this codebase ever overwrites,
re-initializes, or deletes a repo that's already there; only the explicit
init call above ever creates one.

**Disk edits and pushes never clobber each other.** Any file changed
directly on the mounted disk is committed (author `VSNote server
<vault@vsnote>`) before the NEXT git request is served, whether that's a
push evaluating fast-forward/divergence or a plain fetch — so a disk edit
is always real history by the time anything else touches it. After a push
lands, the working tree is updated to match the new branch tip before the
push's own HTTP response reaches the client, so `git clone`/a text editor
reading the mount immediately afterward always sees the pushed content,
never a stale window. `GET /api/vault` (session-only) reports the current
state: whether it's mounted, initialized, the current branch, whether the
working tree has uncommitted changes, and the last commit.

**Reset is refused for a mounted vault.** `POST /api/git-repos/{name}/reset`
("Replace remote with local", see "Real git sync" above) still works
exactly as documented for a legacy (unmounted) repo, but refuses with
`409` for the vault name while it's mounted — it may be the only copy of
the owner's data.

## Data model, policy gate, auth model

Full description lives in `../docs/ARCHITECTURE.md`'s "Backend (v2)"
section (module-by-module) — not duplicated here to avoid the two drifting.
Short version: `app/models.py` (SQLAlchemy, `create_all`, no Alembic yet),
`app/policy.py` (the one deny-by-default gate every `/share/*` request goes
through), `app/auth.py` (Cf-Access JWT / session cookie / bearer token
resolution), `app/security.py` (argon2id, slug gen/validation, signed
cookies, constant-time compares).

## Public share contract (for the Phase 10 client)

`GET /share/{identifier}` (mounted on the root app, **no CORS**)
content-negotiates:

- **Default (no special `Accept`)**: raw bytes of the pinned blob.
  `Content-Type: text/plain; charset=utf-8` **always**, regardless of the
  share's `render_mode` or the original file's extension —
  `X-Content-Type-Options: nosniff`, a locked-down
  `Content-Security-Policy`, `Content-Disposition: inline`. This is true
  for BOTH `render_mode="raw"` and `render_mode="rendered"` shares —
  `render_mode` is metadata the client uses to decide how to *display* the
  content, not something this endpoint enforces on the wire format. The one
  exception (Phase 10.5a, roadmap §5.4): a real browser navigation
  (`Accept: text/html`) instead gets the built SPA's `index.html` — for a
  `render_mode="rendered"` file share, ANY folder share, AND every DENIED
  request (bogus/revoked/expired/restricted/password-required/unresolvable
  relpath — see "Every deny reason is the SAME 404" below: this is a
  navigation-level widening of that section, not an exception to it, since
  the shell bytes returned are identical across every one of those reasons
  and carry no information about which one applied). The SPA then
  re-fetches this exact content itself via the JSON branch below, which
  makes the real access decision. RAW-mode file shares are excluded from
  the HTML-shell branch entirely — they always get raw bytes, browser or
  not (never `text/html`, full stop).
- **`Accept: application/json`**: returns the `ShareContentOut` JSON
  contract (see `app/schemas.py`) — `slug`, `alias`, `source_path`,
  `render_mode`, `media_type_hint`, `blob_id`, `size`, `live`, `content`
  (UTF-8 text, or base64 with `content_encoding: "base64"` for non-UTF-8
  blobs), `created_at`, `last_access_at`, `hit_count`. `X-Content-Type-
  Options: nosniff` is set here too; the server never inlines share content
  into an HTML document itself.

`GET /api/share/{identifier}/content` — **the same JSON contract**, always
(no content negotiation needed), mounted under `/api` instead of the root
app. Both routes go through the exact same policy gate
(`app/policy.py::resolve_share`) — same denial shape, same audit trail.
Pre-Phase-10.5a this was the CORS-enabled twin route for a genuinely
cross-origin SPA deployment; single-origin (roadmap §5.4) made that
scenario out of scope for now, so today this is just a second, equally
valid path to the same JSON — `share/ShareApp.tsx` uses the root route's own
`Accept: application/json` branch instead (a same-origin, relative fetch
either way).

`POST /share/{identifier}/auth` — `{"password": "..."}` → `200 {"ok": true}`
+ sets a signed, `HttpOnly`/`Secure`/`SameSite=Lax` session cookie scoped to
`Path=/share/{slug}` on success. Wrong password AND a nonexistent slug both
return the identical `404 {"detail": "Not found"}`.

`PUT /share/{identifier}` — editor role only. Body is the raw new content;
creates a new content-addressed blob and repoints the share at it. Same
gate, same opaque denial shape for anyone who isn't an editor. 404s
unconditionally for a folder share (`kind=="folder"`) — public editor
write-back for folders isn't built yet, see `docs/ARCHITECTURE.md`'s
"Folder shares (Phase 10.5)" section.

### Folder shares (Phase 10.5, roadmap §5.1)

`GET /share/{identifier}/{relpath:path}` resolves a path inside a
`kind=="folder"` share's snapshot manifest — a file (raw/JSON, same
content-negotiation as above) or a directory (always JSON, a plain
listing). `GET /share/{identifier}` on a folder share is always the
subtree ROOT listing, never a specific file. Both twinned under
`/api/share/{identifier}/content[/relpath]` for the CORS-enabled route.
Resolution is an EXACT string match against that share's manifest rows
(`(share_id, relpath)`) — no filesystem access, no path normalization, no
join — so `..`, an absolute path, an encoded/double-encoded traversal
string, a backslash variant, an excluded entry, and a relpath from a
DIFFERENT share all fail for the identical reason ("no row matched") and
all produce the exact same uniform 404 as every other deny state above.
Full design + the resolution matrix that proves this: `app/routers/
share_public.py`'s module docstring, `app/models.py`'s `ShareManifestEntry`
docstring, `tests/test_folder_shares.py`, and `docs/ARCHITECTURE.md`'s
"Folder shares (Phase 10.5)" section.

### Every deny reason is the SAME 404 — read this before building the share page

**Phase 10.5a scoping note**: this section describes the JSON contract — every
claim below holds exactly as written for `Accept: application/json` (or no
`Accept` header at all). A real BROWSER NAVIGATION (`Accept: text/html`) to
`GET /share/{id}[/{relpath}]` gets the built SPA's `index.html` instead, for
every deny reason listed below AND for a successful rendered-mode/folder
share alike — see "Public share contract" above's first bullet and
`docs/ARCHITECTURE.md`'s "Single-origin deployment (Phase 10.5a)" section for
why that's a widening of this section's own uniformity guarantee (one MORE
class collapsed into the identical shell), not an exception to it. The SPA
then re-fetches the identical URL with `Accept: application/json`, which is
exactly the request/response pair everything below describes.

**There is exactly one deny response, for every GET/HEAD/PUT/PATCH request to
either `/share/{id}` or `/api/share/{id}/content`, for every reason:**

```
404 {"detail": "Not found"}
```

Malformed identifier, nonexistent slug, revoked, expired, restricted (no
identity or wrong identity), token-required (missing or invalid token),
wrong role for the method, **and a real, live, password-protected share
with no session** — all of them, byte-identical, same status, same body,
same headers. There is no separate 401 "enter a password" challenge shape.
This is deliberate and non-negotiable per `docs/ROADMAP-SHARING-AUTH.md`
§1's literal requirement ("404 for missing/revoked/expired/unauthorized-
without-identity look identical") — a distinct 401-for-password-shares-only
response would let anyone holding a candidate slug learn, for free, whether
it names a real record at all (see `app/policy.py`'s module docstring for
the full account, including the measured two-response-class bug this
replaced).

**What this means for the Phase 10 client:** a 404 on a share route can
mean "this link is gone" OR "this link needs a password" OR "this link
never existed" — the response gives no way to tell which, by design. Build
the rendered-share page to reflect that directly:

- On any 404 from `GET /share/{id}` or `GET /api/share/{id}/content`, render
  ONE generic state: something like *"This link is unavailable, or it
  requires a password."* — plus an inline password field.
- The password field always submits to `POST /share/{id}/auth`, regardless
  of whether the client has any reason to believe the share is real or
  password-protected specifically. That endpoint's own response is enough
  to drive the UI:
  - `200` → a session cookie is now set for this slug; re-fetch
    `GET /share/{id}` (now expected to succeed) and render the real page.
  - `404` → wrong password, OR the slug never existed / isn't
    password-protected at all, OR it's dead for some other reason —
    re-render the exact same generic "unavailable, or requires a password"
    state. Do not show a "wrong password" message specifically; that would
    itself reopen the oracle this design closes (it would prove password
    auth mode is in play).
- **Never build client logic that branches on "was this a 404 because the
  slug is malformed vs. revoked vs. password-protected vs. never existed."**
  The server will never give you enough information to make that
  distinction, on purpose. If Phase 10 ever finds itself wanting that
  distinction (e.g. a nicer error message), that's a sign the feature
  needs owner-authenticated tooling (`GET /api/shares`, which DOES
  distinguish these, since the caller is already proven to be the owner) —
  not a change to the public endpoint's response shape.

## Single-origin deployment (Phase 10.5a, roadmap §5.4)

Front + back ship as ONE origin: this process serves the built SPA
alongside `/api`, `/share/*`, `/git/*` (see "Running it" above). The owner
reaches it from outside `localhost` via any HTTPS **reverse proxy or
tunnel** (a different thing from Cloudflare *Access*, the SSO layer
described below; a proxy/tunnel can run with or without Access in front of
it). Reachability itself is the owner's concern, config-only, outside this
repo — this backend's job is to work flawlessly BEHIND that proxy:

- **No settable/configurable origin anywhere.** Every client call
  (`src/share/api.ts`, `src/git/remote.ts`) is relative to
  `window.location.origin` — no `baseUrl` parameter, no Settings field for
  one. There is nothing to misconfigure into pointing at the wrong host.
- **`--proxy-headers --forwarded-allow-ips='*'`** (see "Running it" above) —
  uvicorn trusts `X-Forwarded-Proto`/`X-Forwarded-Host` from the reverse
  proxy or tunnel, so `request.url.scheme`/`.hostname` (and anything derived
  from them) reflect the real external `https://vsnote.example.com`, never
  the local `http://127.0.0.1:8787` this process actually binds.
- **Cookies**: `Secure` (gated by `VSNOTE_COOKIE_SECURE`, default `True`) +
  `SameSite=Lax` on both the app session cookie (`app/routers/auth.py`) and
  the per-share password session cookie (`app/routers/share_public.py`) —
  set `VSNOTE_COOKIE_SECURE=False` ONLY for plain-`http://localhost` dev, per
  `.env.example`'s doc. The share session cookie keeps its
  `Path=/share/<slug>` scoping (unchanged by this phase — see "Public share
  contract" above).
- **No mixed content**: everything (API, share, git, static assets) is
  same-origin and same-scheme as the page itself by construction — there is
  no second host/port for a browser to flag.
- **PWA/service worker**: unaffected by any of the above — it precaches the
  app shell + hashed assets it's always precached (`vite.config.ts`'s
  `VitePWA` config), which still works identically whether served by `vite
  preview` or this backend, since both serve the exact same `dist/` output.

## Cloudflare Access production topology (sketch — not deployed this phase)

Local `uvicorn` only, per `docs/IMPLEMENTATION-PLAN-V2.md`'s explicit
sequencing note ("Deployment (Cloudflare, domains) stays out of scope").
This section sketches the intended SSO shape (layered on top of the tunnel
above) so a later phase doesn't have to re-derive it:

```
                     ┌─────────────────────────────┐
Browser ──HTTPS──▶   │   Cloudflare Access (SSO)    │
                     │   in front of the app origin │
                     └───────────────┬──────────────┘
                                     │ Cf-Access-Jwt-Assertion header
                                     │ added to every request that passes
                                     │ Cloudflare's own SSO challenge
                     ┌───────────────▼──────────────┐
                     │  vsnote.example.com/*         │  ◀── behind CF Access
                     │  (SPA static assets + /api)  │
                     ├───────────────────────────────┤
                     │  vsnote.example.com/share/*    │  ◀── CF Access policy
                     │                               │      EXCLUDES this path
                     └───────────────┬───────────────┘      (roadmap §2)
                                     │
                          same origin, same FastAPI process
                                     │
                     ┌───────────────▼───────────────┐
                     │        This backend            │
                     │  (app/main.py's `app`)         │
                     └─────────────────────────────────┘
```

Key points, all already implemented this phase so a later deploy is
config-only:

- **`/share/*` is excluded from the Cloudflare Access policy** (configured
  on the Cloudflare dashboard/Terraform, outside this repo) — capability
  links must work for recipients with no Cloudflare Access identity at all.
  Everything else (`/`, `/api/*`) stays behind CF Access exactly as today.
- **The backend verifies `Cf-Access-Jwt-Assertion` itself** — signature
  (JWKS fetched from `https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`,
  cached), issuer, audience, `exp`/`nbf` (`app/auth.py::verify_cf_access_jwt`).
  It **never trusts the network path** (i.e. "this request reached me, so
  Cloudflare must have already checked it") and **never trusts the
  unsigned** `Cf-Access-Authenticated-User-Email` header on its own — see
  `tests/test_auth.py::test_cf_access_unauthenticated_email_header_alone_is_never_trusted`.
  This matters even behind Cloudflare: it means a misconfigured origin
  firewall rule that let traffic bypass Cloudflare wouldn't grant access
  either — the JWT verification is the actual authority, not the header's
  mere presence.
- Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` for the real deployment;
  leaving them unset (as in dev) makes the whole verification path
  unavailable rather than an implicit allow (tested:
  `test_cf_access_unconfigured_server_does_not_accept_assertions`).
  `VSNOTE_COOKIE_SECURE=True` (the default) and a real `VSNOTE_SECRET_KEY`
  are both required for a real deployment.
