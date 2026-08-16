# Changelog

VSNote is a local-first note and code workspace: VSCode's shell (file tree,
tabs, real in-browser git, diffs, syntax highlighting) with Obsidian's writing
experience (live-preview markdown that reveals raw syntax only around the
cursor). A single-origin FastAPI backend adds fortified sharing, auth, and
real git sync — while the app itself stays fully usable offline.

Releases are versioned by date (CalVer, `YYYY.MM.DD`). Entries below start at
the first public release; the pre-release development history (the full v1
client and the v2 backend, August 2026) lives in the git log.

## [Unreleased]

### Added
- CHANGELOG (this file).

## [2026.08.17] — first public release

Everything to date, in brief:

- **Editor**: CodeMirror 6 throughout — source, unified/side-by-side diff, and
  Obsidian-style live preview; VSCode-style find widget; grid split view with
  drag-to-dock panes; zen mode.
- **Vault**: in-browser git (isomorphic-git + IndexedDB), file tree with
  drag & drop, drafts that survive reloads, PWA offline install, zip export.
- **Sharing**: publish files or folders to `/share/<slug>` with roles, expiry,
  password, alias, raw/rendered modes; uniform deny-by-default policy gate.
- **Sync**: real push/pull against the backend's bare git repos over
  smart-HTTP; safe auto-merge with backup refs; in-editor conflict resolver;
  commit message templates.
- **CI**: full test suite (vitest + Playwright + pytest) green on GitHub
  Actions with retries disabled; GitHub Pages client-only demo.
