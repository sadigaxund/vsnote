# Slate backend (Phase 9 + Phase 11)

FastAPI + SQLite backend providing sharing, auth (Phase 9), and real git sync
(Phase 11) for the Slate SPA. Spec: `../docs/ROADMAP-SHARING-AUTH.md` (the
security posture in §1 is binding) and `../docs/IMPLEMENTATION-PLAN-V2.md`'s
"Phase 9"/"Phase 11" sections. See `../docs/ARCHITECTURE.md`'s "Backend (v2)"
and "Real sync (Phase 11)" sections for how this maps onto the rest of the
project's docs.

The SPA (`src/`) must remain fully usable with this backend down — see
CLAUDE.md rule 3. Nothing in this directory is required for `npm run dev`.

## Running it

```sh
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
cp server/.env.example server/.env   # optional — sane defaults without it
npm run server                        # from the repo root
```

`npm run server` runs:

```sh
server/.venv/bin/python -m uvicorn app.main:app --reload --port 8787 --app-dir server
```

Interactive API docs: `http://127.0.0.1:8787/docs` (owner/`/api` routes only
— `/share/*` isn't a documented-schema surface on purpose, it's raw/JSON
content negotiation, see below).

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
| `SLATE_DB_URL` | `sqlite:///./slate.db` | SQLAlchemy URL |
| `SLATE_SECRET_KEY` | *(none)* | **Required** when `SLATE_ENV=prod`; auto-generated ephemeral + loud warning in dev |
| `SLATE_CORS_ORIGINS` | `http://127.0.0.1:5290,http://localhost:5290` | `/api/*` only, never `/share/*`, never a wildcard |
| `SLATE_PORT` | `8787` | reserved for this backend across the project — never 5173/5174/8000/5290 |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | *(unset)* | leaving these unset disables the Cf-Access path entirely (not an implicit allow) |
| `SLATE_MAX_BLOB_BYTES` | `5242880` (5 MiB) | `POST /api/blobs` and `PUT /share/{id}` both enforce this → 413 |
| `SLATE_RATE_LIMIT_DEFAULT` / `_SHARE` / `_SHARE_AUTH` | `120/minute` / `60/minute` / `5/minute` | slowapi limit strings; `_SHARE_AUTH` is the brute-force throttle on `POST /share/{id}/auth` and `POST /api/auth/login` |
| `SLATE_SESSION_TTL_MIN` | `30` | both the app session cookie and per-share password session cookie |
| `SLATE_COOKIE_SECURE` | `True` | set `False` only to test over plain `http://` locally |
| `SLATE_GIT_ROOT` | `./git-repos` | Phase 11 — where bare git repos live, `{root}/{repo}.git`, created on demand |

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
`401` with `WWW-Authenticate: Basic realm="slate-git"` so real git clients
know to prompt/retry with credentials — this is a genuine auth challenge
surface, unlike `/share/*`'s deliberate uniform-404 no-oracle posture (roadmap
§1); the two are not the same kind of endpoint and are not held to the same
response-shape rule.

**Path safety**: the repo name is user input straight off the URL. It's
validated against `^[A-Za-z0-9_-]{1,64}$` (`app/gitrepo.py::REPO_NAME_RE`)
*before* ever being joined onto a filesystem path — that alone makes `..` and
`/` structurally unrepresentable in a valid name — plus a second check that
the resolved path is still inside `SLATE_GIT_ROOT`, in case `SLATE_GIT_ROOT`
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

**CORS** is enabled on `/git/*` (unlike `/share/*`, which deliberately has
none) — browser isomorphic-git needs it: `Authorization` is a non-simple
header and the upload-pack/receive-pack request bodies use non-simple content
types, so the browser preflights with `OPTIONS` before every real request.
Locked to `SLATE_CORS_ORIGINS` (never a wildcard), same list `/api` uses, via
its own `CORSMiddleware` instance — `/share/*`'s zero-CORS posture is
untouched.

**Fast-forward-only is enforced client-side**, not here: this server has no
opinion about non-fast-forward pushes at the protocol level (plain dulwich
`receive-pack` doesn't reject them the way e.g. GitHub's `receive.
denyNonFastforwards` policy would). The Slate client (`src/git/remote.ts`)
refuses to attempt a push at all once it detects local/remote have diverged —
see `docs/ARCHITECTURE.md`'s "Real sync (Phase 11)" section for the exact
policy and how it's surfaced in the UI.

## Data model, policy gate, auth model

Full description lives in `../docs/ARCHITECTURE.md`'s "Backend (v2)"
section (module-by-module) — not duplicated here to avoid the two drifting.
Short version: `app/models.py` (SQLAlchemy, `create_all`, no Alembic yet),
`app/policy.py` (the one deny-by-default gate every `/share/*` request goes
through), `app/auth.py` (Cf-Access JWT / session cookie / bearer token
resolution), `app/security.py` (argon2id, slug gen/validation, signed
cookies, constant-time compares).

## Public share contract (for the Phase 10 client)

`GET /share/{identifier}` (mounted on the root app, **no CORS** — see
below) content-negotiates:

- **Default (no special `Accept`)**: raw bytes of the pinned blob.
  `Content-Type: text/plain; charset=utf-8` **always**, regardless of the
  share's `render_mode` or the original file's extension —
  `X-Content-Type-Options: nosniff`, a locked-down
  `Content-Security-Policy`, `Content-Disposition: inline`. This is true
  for BOTH `render_mode="raw"` and `render_mode="rendered"` shares —
  `render_mode` is metadata the client uses to decide how to *display* the
  content, not something this endpoint enforces on the wire format.
- **`Accept: application/json`**: returns the `ShareContentOut` JSON
  contract (see `app/schemas.py`) — `slug`, `alias`, `source_path`,
  `render_mode`, `media_type_hint`, `blob_id`, `size`, `live`, `content`
  (UTF-8 text, or base64 with `content_encoding: "base64"` for non-UTF-8
  blobs), `created_at`, `last_access_at`, `hit_count`. `X-Content-Type-
  Options: nosniff` is set here too; the server never inlines share content
  into an HTML document itself.

`GET /api/share/{identifier}/content` — **the same JSON contract**, always
(no content negotiation needed), but mounted under the CORS-enabled `/api`
sub-app instead of the root app. Use this one from the SPA's rendered-share
page (Phase 10) so a cross-origin `fetch(..., {credentials: "include"})`
from `http://127.0.0.1:5290` actually gets `Access-Control-Allow-Origin`
back. Both routes go through the exact same policy gate
(`app/policy.py::resolve_share`) — same denial shape, same audit trail —
the only difference is CORS eligibility.

`POST /share/{identifier}/auth` — `{"password": "..."}` → `200 {"ok": true}`
+ sets a signed, `HttpOnly`/`Secure`/`SameSite=Lax` session cookie scoped to
`Path=/share/{slug}` on success. Wrong password AND a nonexistent slug both
return the identical `404 {"detail": "Not found"}`.

`PUT /share/{identifier}` — editor role only. Body is the raw new content;
creates a new content-addressed blob and repoints the share at it. Same
gate, same opaque denial shape for anyone who isn't an editor.

### Every deny reason is the SAME 404 — read this before building the share page

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

## Cloudflare Access production topology (sketch — not deployed this phase)

Local `uvicorn` only, per `docs/IMPLEMENTATION-PLAN-V2.md`'s explicit
sequencing note ("Deployment (Cloudflare, domains) stays out of scope").
This section sketches the intended shape so a later phase doesn't have to
re-derive it:

```
                     ┌─────────────────────────────┐
Browser ──HTTPS──▶   │   Cloudflare Access (SSO)    │
                     │   in front of the app origin │
                     └───────────────┬──────────────┘
                                     │ Cf-Access-Jwt-Assertion header
                                     │ added to every request that passes
                                     │ Cloudflare's own SSO challenge
                     ┌───────────────▼──────────────┐
                     │  slate.example.com/*         │  ◀── behind CF Access
                     │  (SPA static assets + /api)  │
                     ├───────────────────────────────┤
                     │  slate.example.com/share/*    │  ◀── CF Access policy
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
  `SLATE_COOKIE_SECURE=True` (the default) and a real `SLATE_SECRET_KEY`
  are both required for a real deployment.
