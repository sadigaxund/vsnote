<div align="center">

<img src="public/favicon.svg" alt="VSNote logo" width="72" />

# VSNote

**A local-first note and code workspace: VSCode's shell, Obsidian's writing experience.**

[![CI](https://github.com/sadigaxund/vsnote/actions/workflows/ci.yml/badge.svg)](https://github.com/sadigaxund/vsnote/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/sadigaxund/vsnote?label=release)](https://github.com/sadigaxund/vsnote/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-teal)](LICENSE)

[Live demo](https://sadigaxund.github.io/vsnote/) · [Releases](https://github.com/sadigaxund/vsnote/releases) · [Docs](docs/)

</div>

VSNote runs entirely in your browser: a real git repository (via isomorphic-git and IndexedDB), a file tree with drag and drop, tabs, diffs, and syntax highlighting, wrapped around an Obsidian-style markdown editor where raw syntax reveals itself only in the smallest region around your cursor. An optional single-origin backend adds hardened file sharing and real git sync. Your notes never require a server: with the backend down, an installed or cached app keeps editing fully offline.

> [!NOTE]
> The [live demo](https://sadigaxund.github.io/vsnote/) is the client only. Sharing and sync buttons show their server-offline states there by design; run the backend (below) for the full experience.

## Features

- **Live-preview markdown**: rendered headings, bold, links, lists, and checkboxes that open into raw syntax only around the cursor, powered by one CodeMirror 6 stack for source, diff, and preview.
- **Real git in the browser**: status letters, gutter markers, unified and side-by-side diffs, commits, and history, persisted in IndexedDB.
- **VSCode-grade shell**: file tree with inline rename and drag-and-drop moves, closable and draggable tabs, grid split view with drag-to-dock panes, command palette, floating find widget, zen mode.
- **Sharing**: publish a file or a whole folder to `/share/<slug>` with roles, expiry, password, custom alias, and raw or rendered modes, behind a single deny-by-default policy gate with indistinguishable 404s.
- **Sync**: push and pull against the backend's bare git repos over smart HTTP, with safe auto-merge, backup refs before every merge, an in-editor conflict resolver, and commit message templates.
- **Offline-first PWA**: installable, boots and edits with no network, one-click vault export to zip.

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/sadigaxund/vsnote.git
cd vsnote
cp .env.example .env   # set SLATE_BOOTSTRAP_USER / SLATE_BOOTSTRAP_PASSWORD
docker compose up
```

Open `http://localhost:8787`. One image serves everything: the app, the API, shares, and git sync. Vault database and sync repos live in named volumes and survive `docker compose down`.

### From source

```bash
npm ci && npm run build                 # build the SPA
python3 -m venv server/.venv && server/.venv/bin/pip install -r server/requirements.txt
npm run server                          # uvicorn serves app + API on :8787
```

For development with hot reload, run `npm run dev` in a second terminal and open the URL vite prints; it proxies `/api`, `/share`, and `/git` to the backend.

## Configuration

Everything is an environment variable with a working default; see [`.env.example`](.env.example) for the full list. The ones you are most likely to set:

| Variable | Default | Purpose |
|---|---|---|
| `SLATE_PORT` | `8787` | Listen port |
| `SLATE_BOOTSTRAP_USER` / `SLATE_BOOTSTRAP_PASSWORD` | unset | Create the login account on first boot if none exists |
| `SLATE_SECRET_KEY` | unset | Session signing key, required when `SLATE_ENV=prod` |
| `SLATE_COOKIE_SECURE` | `true` | Set `false` only for plain-HTTP LAN testing |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | unset | Enable Cloudflare Access JWT verification |

> [!IMPORTANT]
> For any deployment reachable from the internet, set `SLATE_ENV=prod` with a real `SLATE_SECRET_KEY`, and front the app with HTTPS (a Cloudflare tunnel pointed at the container works out of the box; the server honors forwarded proto and host headers).

## Testing

```bash
npm test                                   # 157 unit + 90 e2e (vitest + Playwright)
server/.venv/bin/python -m pytest server/tests -q   # backend suite
```

CI runs the full suite with retries disabled, so a green check means every test passed on the first try.

## How it is built

The client is React 18 + TypeScript (strict) with zustand stores, [my-you-eye](https://github.com/sadigaxund/my-you-eye) components, CodeMirror 6, and isomorphic-git over lightning-fs. The backend is FastAPI + SQLite, serving the built SPA, the share API, and bare git repos from one origin, so there is no CORS anywhere. Design and architecture decisions live in [`docs/`](docs/), including the security posture for sharing ([`docs/ROADMAP-SHARING-AUTH.md`](docs/ROADMAP-SHARING-AUTH.md)) and the component backlog tracking what was built locally versus provided by the library.
