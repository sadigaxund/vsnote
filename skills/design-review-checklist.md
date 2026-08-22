# Design review checklist

Standing pre-merge visual-audit process, adopted from
`skills/references/julianoczkowski/designer-skills/design-review/` (TODO
§7.1). Applies to any feature that changes what the user SEES. Run it after
the code gates pass (`npm run build && npm run lint && npm run typecheck &&
npm run test:unit`) and before committing.

## Evidence is mandatory

Screenshots ARE the review. Capture every applicable state into
`.design/<feature>/` (gitignored) with traceable filenames:

- default view at 1280px and 900px wide
- hover AND keyboard-focus state on every interactive element touched
- loading / empty / error states if the feature has any
- one alternate theme + dark variant when tokens were touched
- zoom 200% spot-check when layout was restructured

## Findings format

Rank every observation Must-fix / Should-fix / Could-improve:

- **Must** — violates DESIGN-SPEC, a11y contract, or breaks a flow
- **Should** — inconsistency with an established surface pattern
- **Could** — polish; batch these, never block a merge on them

A review with zero findings still writes the file (one line: scope +
"no findings"), so absence of evidence stays visible.

## Anti-pattern sweep (from vercel-labs web-interface-guidelines)

- interactive `<div>`/`<span>` instead of button/link
- `outline-none` without a focus-visible replacement
- `transition: all`
- raw color values where a semantic token exists
- text truncation without a tooltip or expansion path
- destructive action reachable without confirmation
