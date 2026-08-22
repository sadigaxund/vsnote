# UI standards — IA glossary + copy rules

Standing reference for user-facing language (TODO §7.3/§7.5, adopted from the
vendored UXUI cluster: better-writing's capitalization/vocabulary rules,
ux-writing-skill's message patterns, anthropic ux-copy's consequence-labeled
confirms). These are checkable standards, not taste. The em-dash ban
(`tests/unit/uiCopyEmDash.test.ts`) and DESIGN-SPEC remain authoritative above
this file.

## IA glossary — one noun per concept

| Term | Means | Never call it |
|---|---|---|
| vault | the whole workspace (one per browser) | workspace, project |
| note | a markdown file in the vault | document, entry |
| file | any non-markdown file | asset, attachment |
| tab | an open editor view of a path | editor, window |
| pane | a split region holding its own tab strip | split, column |
| share | a published link with policy + snapshot | link (the URL itself), publish |
| sync | fetch + push/auto-merge against the remote | backup, upload |
| remote | the git server the vault syncs to | mirror (that's a secondary remote), origin (git plumbing) |

## Copy rules

1. **Sentence case everywhere** — titles, buttons, palette entries, Settings
   categories, status segments. Never Title Case; never fake it with
   `text-transform: capitalize`.
2. **Confirm buttons name the consequence.** Bare Yes/No/OK/Submit are banned
   on consequential dialogs (`Reset settings` / `Keep changes`;
   `Wipe & pull`; `Replace file` / `Keep both`).
3. **Error toasts follow `[What failed]. [Why]. [Next imperative step].`**
   Banned: "Something went wrong", "Invalid …", exclamation marks, passive
   voice without an actor.
4. **Wizard vocabulary**: enter = `Get started`, advance = `Continue`,
   finish = `Done`. No synonyms across steps.
5. **Filter-empty states name the query** ("No settings matching 'sync'")
   with exactly one recovery action.
6. **Settings labels**: toggles describe the ON state positively; no
   possessives ("Favorites" not "Your Favorites"); "Select", never "Click";
   failures say what couldn't load, never "We're having trouble".
7. **Numbers are `tabular-nums`** on every comparing/ticking surface.
