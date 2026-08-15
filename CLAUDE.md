# vsnote ("Slate")

A local-first note/code workspace: VSCode's shell and power (file tree, tabs, git, syntax
highlighting, diffs) with Obsidian's writing experience (rendered markdown with
live-preview editing). Browser-only — no server, no terminal, no code execution.

The visual target is `app-preview.png` at the repo root. Match it closely: near-black
surfaces, teal/cyan accent, mono UI chrome. Read `docs/DESIGN-SPEC.md` before building UI.

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
   security posture is binding). The SPA must remain fully usable with the backend
   down — share/sync UI degrades gracefully. Python work uses `server/.venv`.
4. **Docs are law.** `docs/DESIGN-SPEC.md` (what it looks like),
   `docs/ARCHITECTURE.md` (how it's built), `docs/IMPLEMENTATION-PLAN.md` (phases).
   If you must deviate, update the doc in the same commit and say why.
5. **Quality gates before claiming done:** `npm run build` and `npm run lint` pass;
   `npx tsc --noEmit` clean. Verify UI changes visually when a browser tool is available.
6. **Git hygiene.** Small, scoped commits with conventional messages
   (`feat(shell): …`, `fix(editor): …`, `docs: …`). Commit at the end of every phase or
   sizable unit of work. Never leave the tree dirty at handoff. Never force-push.
7. **Editor stack is CodeMirror 6** — one stack for source, diff, and markdown
   live-preview. Do not introduce Monaco. Adapting proven open-source CM6 code
   (with license attribution in the file header) is encouraged over reinventing.
8. **TypeScript strict**, React 18 function components, zustand for state.
   Match existing file/naming conventions once the scaffold exists.
