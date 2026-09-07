# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a single developer-writer organizing their own files, both notes and code,
in one self-hosted vault. They already have VS Code and Obsidian habits and expect both:
a file tree, tabs, diffs, and git on one side; rendered, live-editable markdown on the other.

Second job for the same person: using Markii directives to grow that vault into a
static-website-like structure or a documentation keeper, published page by page through
shares (linked shares behave as a small blog or docs site).

Visitors of shared pages are a secondary audience: they read one rendered page (or fetch raw
bytes with curl/wget). They never see the app shell.

No collaboration features yet. Even for a single personal user, onboarding and in-context
help elements are wanted (owner-confirmed 2026-09-07).

## Product Purpose

VSNote is a local-first note and code workspace that runs entirely in the browser: a real git
repository (isomorphic-git over IndexedDB), a VS Code-grade shell, and an Obsidian-style
live-preview markdown editor, with Markii directives rendered inline. An optional single-origin
FastAPI backend adds hardened single-file sharing, a durable vault copy, and real git sync.

Success: the owner keeps every note and code file in one place, never loses work (auto-sync to
a durable remote, restore-from-remote onboarding), writes markdown that renders as they type,
and can publish any single file as a clean page or raw bytes with one dialog.

## Positioning

Owner did not pick a single claim (2026-09-07: "all of the above"). Three truthful
differentiators recorded as a set, none ranked:

- Browser-only, server-optional git workspace: editing never requires a server; the backend
  only adds sharing and sync, on the same origin, with no CORS anywhere.
- Obsidian's writing experience inside VS Code's shell, plus Markii directives with live
  preview and Lua scripting in a Worker isolate.
- Hardened single-file sharing: raw or rendered, uniform 404 on every deny, unguessable slugs
  or short aliases, per-share tokens/passwords/expiry, linked shares forming a blog.

## Operating Context

- Self-hosted: `npm run server` (uvicorn on :8787 serving SPA + API + bare git repos) with
  `npm run dev` for hot reload. Env-configured (`.env.example`); `VSNOTE_VAULT_PATH` is the
  durable working-tree copy.
- Daily flow: open vault, edit notes (`.md`, `.mk.md`) and code, commit/sync via the shell,
  publish selected files via the Publish wizard, manage them in the Shared view.
- Public reader: chrome-less page with a small visitor preference pill (theme, font size,
  code wrap). Non-browser clients get raw bytes via content negotiation.
- Custom git remotes (GitHub etc.) go through the backend's allowlisted same-origin git proxy.

## Capabilities and Constraints

Confirmed capabilities: file tree with drag/drop and inline rename; closable/draggable tabs;
grid split panes; command palette; find widget; zen mode; Source / Rendered / Diff / Preview
modes per file type; syntax highlighting for every language `@codemirror/language-data` knows;
git status, gutters, unified and side-by-side diffs, history, fast-forward push/pull, auto-sync
policies; single-file shares (raw or rendered) with tokens, passwords, expiry, aliases, back
links and a dynamic link map; Markii directives (parse, render, live preview, completion,
fence-nesting sugar), Lua scripts in a Worker isolate with grants and tiers, `.mkz` bundles,
packs (Lua modules and completion only; pack `webview.js` is never executed).

Hard constraints (binding, from CLAUDE.md and docs):
- UI components come from `my-you-eye`; missing or force-styled components are built under
  `src/components/local/` and reported upstream as issues.
- Editor stack is CodeMirror 6 only; no Monaco.
- Client stays server-optional; the SPA must boot, render and edit with the API down.
- Sharing security posture in `docs/ROADMAP-SHARING-AUTH.md` is binding.
- No backwards-compatibility code.
- `docs/DESIGN-SPEC.md` is the visual authority; `docs/ARCHITECTURE.md` the structural one.

Terminology: vault (the repo), share (one published file), alias (owner-chosen share path),
back link (a share's pointer to another share), Rendered / Source / Diff / Preview (file
modes), pack (a Markii component + Lua bundle), grant (permission for a script capability).

Undecided product facts: collaboration model (none yet); whether pack components will ever
render (needs a sandboxed host protocol upstream); scheduled/automatic script triggers.

## Brand Commitments

- Name: VSNote (rebranded from the internal "Slate" on 2026-08-17; nothing visible says Slate).
- Logo: VS Code-style "<" ribbon arms behind a folded-corner markdown page; master
  `public/favicon.svg`, mono variant `public/logo-mono.svg`.
- Visual identity as recorded in `docs/DESIGN-SPEC.md`: near-black surfaces, teal/cyan accent
  (`#27d2c5`), monospace UI chrome. Recorded, not expanded, here.
- Voice: terse, technical, no em dashes in UI copy (DESIGN-SPEC copy rule).

## Evidence on Hand

- Live client-only demo: https://sadigaxund.github.io/vsnote/ (sharing/sync show offline states).
- Demo vault fixtures used by e2e (`VSNOTE_DEMO_VAULT=1`).
- Design history: `docs/DESIGN-SPEC.md` amendments rounds 1 to 12; screenshots under
  `.design/` (gitignored).
- No testimonials, customers, benchmarks, or pricing exist. Do not fabricate any.

## Product Principles

1. The file is the unit: one file edits, one file shares, one file renders. No hidden containers.
2. Never lose work: durability is visible in the status bar and recoverable from the remote.
3. Two muscle memories, one shell: VS Code for navigation and git, Obsidian for writing.
4. Reading beats chrome: shared pages show only the document; the app stays out of the visitor's way.
5. Deny uniformly, explain locally: security never leaks existence; the owner's UI explains every state.

## Accessibility & Inclusion

Keyboard operability and WCAG non-text contrast on focus rings are enforced by the
`VSNOTE_UI_AUDIT=1` Playwright pass (reflow at 320/480, text spacing, focus ring 3:1 floor,
status text contrast). Preserve these gates in any visual change.
