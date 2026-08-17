# VSNote

A local-first note/code workspace: VSCode's shell and power (file tree, tabs, git, syntax
highlighting, diffs) with Obsidian's writing experience (rendered markdown with
live-preview editing). Browser-only — no server, no terminal, no code execution.
Branding note: the project was internally "Slate" until 2026-08-17 (DESIGN-SPEC
item 34 rebrand). Nothing user- or operator-visible says Slate anymore. The few
surviving mentions are deliberate history — CHANGELOG's breaking entry, the
spec item itself, and docs describing `SLATE_CORS_ORIGINS`, a variable that was
deleted before the rename (renaming a dead name would falsify the record).

The visual target was a reference screenshot (`app-preview.png`, removed from the
repo 2026-08-17 along with `search.png`; both remain in git history pre-removal):
near-black surfaces, teal/cyan accent, mono UI chrome. `docs/DESIGN-SPEC.md` is now
the sole visual authority — read it before building UI.

## Rules for every agent working in this repo

1. **UI components come from `my-you-eye` (npm, v0.4.0+).** Before building ANY UI, read
   `skills/SKILL.md` + `skills/components.json` in this repo (populated by
   `npx my-you-eye init`); until then, `npx my-you-eye list`. Never hand-roll a styled
   button/input/select/table/tree/menu/dialog that the library already provides.
   Restyle via CSS variables / theme tokens at the root — never fork or wrap-override
   library components.
2. **Missing component protocol.** If the library genuinely lacks what you need
   (e.g. context menu, closable tab bar), build it locally under `src/components/local/`
   in the library's style (tokens, variants, a11y) **and add an entry to
   `docs/COMPONENT-BACKLOG.md`** describing the component, its props/variants, and where
   it's used. Do not silently inline one-offs. Do not simplify the design to avoid
   building a missing piece.
3. **Client stays server-optional.** Git runs in-browser (isomorphic-git +
   lightning-fs). No terminal, no code running. As of 2026-08-15 v2 is IN SCOPE
   (`docs/IMPLEMENTATION-PLAN-V2.md`): a FastAPI backend under `server/` provides
   sharing, auth, and real remote sync per `docs/ROADMAP-SHARING-AUTH.md` (its
   security posture is binding). Front + back deploy as ONE origin: the backend
   serves the built SPA, all client URLs are relative, no CORS anywhere
   (roadmap §5.4). "Usable with backend down" means an already-loaded or
   PWA-cached app keeps editing fully offline with share/sync degrading
   gracefully — the SPA bundle must never require the API to boot, render, or
   edit. Python work uses `server/.venv`.
4. **Docs are law.** `docs/DESIGN-SPEC.md` (what it looks like),
   `docs/ARCHITECTURE.md` (how it's built), `docs/IMPLEMENTATION-PLAN.md` (phases).
   If you must deviate, update the doc in the same commit and say why.
5. **Quality gates before claiming done:** `npm run build`, `npm run lint`, and
   `npm run typecheck` all pass. Verify UI changes visually when a browser tool is
   available. Do NOT use `npx tsc --noEmit`: the root `tsconfig.json` is a solution
   file (`"files": []`), so that command typechecks nothing and always exits 0 (it
   was a silent no-op in this repo and in CI until 2026-08-17). `npm run typecheck`
   runs `tsc -b`, which really checks `src/` and `vite.config.ts`.
   Note `tests/` is in neither project's `include`, so specs are only type-checked
   by their runners.
6. **Git hygiene.** Small, scoped commits with conventional messages
   (`feat(shell): …`, `fix(editor): …`, `docs: …`). Commit at the end of every phase or
   sizable unit of work. Never leave the tree dirty at handoff. Never force-push.
7. **Editor stack is CodeMirror 6** — one stack for source, diff, and markdown
   live-preview. Do not introduce Monaco. Adapting proven open-source CM6 code
   (with license attribution in the file header) is encouraged over reinventing.
8. **TypeScript strict**, React 18 function components, zustand for state.
   Match existing file/naming conventions once the scaffold exists.
