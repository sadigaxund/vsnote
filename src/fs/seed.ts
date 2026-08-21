/**
 * Idempotent demo-vault seeder. Reproduces every state DESIGN-SPEC §3 /
 * "Git features" describes as REAL isomorphic-git history + working-tree
 * edits, not hardcoded status letters:
 *
 *  - three real commits on the default branch (`main`)
 *  - `architecture.md` modified unstaged (M) — its committed vs working
 *    content is hand-authored so `git/diff.ts`'s real LCS diff genuinely
 *    computes +12 -5 (verified with the exact production `toLines()`
 *    splitting logic before being written here; see the module comment on
 *    `ARCHITECTURE_MD_HEAD`/`_WORKING` below)
 *  - `indexer.ts`, `metrics.csv` modified unstaged (M)
 *  - `searchRank.ts` modified unstaged (M) — a second code-diff showcase
 *    tuned for the DIFF VIEW: exactly 4 separated hunks, +26 −10 (verified
 *    with real `git diff -U3`; see the comment above its content pair)
 *  - `legacy-parser.ts` deleted from the working tree, unstaged (D)
 *  - `GraphView.tsx` written + staged, never committed (A)
 *  - `daily-2026-08-14.md` written, never staged (U)
 *  - `reading-list.md`, `theme.css`, `vault.config.json`, `assets/cover.png`
 *    committed and left untouched (no status letter)
 *
 * `ensureSeeded()` is safe to call on every boot: it checks for
 * `/vault/.git` and no-ops if the repo already exists. `resetVault()`
 * wipes the IndexedDB-backed filesystem and reseeds from scratch — exported
 * for the command palette to wire up in Phase 5, per IMPLEMENTATION-PLAN.md
 * Phase 2's "a 'Reset demo vault' function re-seeds from scratch (wiring it
 * to the command palette is Phase 5 — just export it)".
 *
 * DESIGN-SPEC Amendments round 5 item 36 made all of the above OPT-IN. The
 * demo vault described here now seeds only when the build sets
 * `VSNOTE_DEMO_VAULT=1` (CI's Pages job and `npm run test:e2e` both do);
 * every other build seeds the minimal `welcome.md` vault instead, and
 * `resetVault()` resets to whichever of the two this build uses.
 * `loadDemoVault()` forces the demo vault regardless, for the palette's
 * "Load demo vault" command.
 */
import * as git from "isomorphic-git";
import { fs, GIT_DIR, DEFAULT_BRANCH, DEMO_AUTHOR } from "../git/client";
import { pathExists, removePath, writeFile } from "./operations";
import { resetFilesystem } from "./client";
import { VAULT_DIR } from "./paths";
import { coverPngBytes } from "./coverPng";

const READING_LIST_MD = `# Reading list

- [ ] "Designing Data-Intensive Applications" — ch. 3, index structures
- [x] isomorphic-git internals: the packfile format
- [ ] Obsidian's live preview decoration model (CodeMirror RangeSet)
`;

const DAILY_NOTE_MD = `# 2026-08-14

- Wired the git status matrix into the Explorer tree — M/A/D/U letters now
  come from a real \`statusMatrix()\` call, not hardcoded props.
- \`architecture.md\`'s +12 -5 chip is a real computed line diff vs HEAD.
- Next: gutter markers in Source mode (Phase 3).
`;

const THEME_CSS = `:root {
  --graph-node-radius: 4px;
  --graph-edge-color: #27d2c5;
}
`;

const LEGACY_PARSER_TS = `// Superseded by src/indexer.ts's incremental walker. Kept around until the
// new path handles every legacy note format.
export function parseLegacy(source: string): string[] {
  return source.split(/\\n{2,}/);
}
`;

/**
 * DESIGN-SPEC Amendments item 15 ("Representative demo data"): replace the
 * toy 7-line config with deep nesting, arrays of objects, and long string
 * values, so `renderers/JsonView.tsx`'s `TreeView` has real structure to
 * exercise (object → array-of-objects → nested object, several levels
 * deep) instead of one flat key/value layer. `vault.config.json` is never
 * given a working-tree edit (see `seedVault()` below) — it stays committed
 * and clean, matching the original file's status; this change is content
 * only, no git-invariant is at stake here the way `metrics.csv`'s is.
 */
const VAULT_CONFIG_JSON = `{
  "name": "vault",
  "version": "1.4.0",
  "theme": "vsnote-dark",
  "workspace": {
    "id": "wsp_8f21c3",
    "createdAt": "2025-11-02T09:14:00Z",
    "owner": {
      "name": "Priya Natarajan",
      "email": "priya@example.com",
      "roles": ["admin", "editor"]
    },
    "members": [
      { "id": "usr_01", "name": "Priya Natarajan", "role": "admin", "lastActive": "2026-08-14T22:10:00Z" },
      { "id": "usr_02", "name": "Devon Okafor", "role": "editor", "lastActive": "2026-08-13T18:41:00Z" },
      { "id": "usr_03", "name": "Mika Lindqvist", "role": "viewer", "lastActive": "2026-08-10T07:02:00Z" }
    ]
  },
  "defaultMode": {
    "md": "rendered",
    "ts": "source",
    "tsx": "source",
    "json": "source",
    "css": "source",
    "csv": "rendered",
    "html": "rendered"
  },
  "indexing": {
    "engine": "incremental",
    "lastFullRebuild": "2026-08-01T03:00:00Z",
    "stats": { "notes": 50214, "coldIndexMs": 873, "incrementalP95Ms": 42 },
    "excludePatterns": ["**/*.tmp", "**/.DS_Store", "assets/raw/**"]
  },
  "integrations": {
    "git": {
      "remote": "https://git.example.internal/notes/vault.git",
      "defaultBranch": "main",
      "syncStrategy": "manual"
    },
    "plugins": [
      {
        "id": "graph-view",
        "enabled": true,
        "settings": { "maxDepth": 3, "physics": { "gravity": -0.6, "linkDistance": 120 } }
      },
      { "id": "daily-notes", "enabled": false, "settings": {} },
      { "id": "csv-preview", "enabled": true, "settings": { "delimiter": ",", "headerRow": true } }
    ]
  },
  "changelog": [
    {
      "version": "1.4.0",
      "date": "2026-08-01",
      "notes": "Switched the indexer to an incremental walker so cold-start latency on a 50k-note vault dropped from roughly 1.4 seconds to under a second, with a documented p95 for incremental updates instead of a single averaged figure."
    },
    {
      "version": "1.3.0",
      "date": "2026-05-18",
      "notes": "Retired the legacy line-based parser in favor of the lezer-markdown syntax tree for link and heading extraction."
    },
    {
      "version": "1.2.1",
      "date": "2026-03-02",
      "notes": "Fixed a race between the git status refresh and the tree re-render that occasionally left a stale status letter after a save."
    }
  ]
}
`;

/**
 * DESIGN-SPEC Amendments item 15: `metrics.csv` gets 12+ columns and 40+
 * rows with mixed types (dates, URLs, floats, long text cells) so
 * `renderers/CsvTable.tsx`'s `DataTable` genuinely exercises truncation,
 * horizontal scrolling, and the sticky header — the previous fixture was a
 * 2-column, 2-3-row `metric,value` toy table.
 *
 * Built by a small deterministic generator (no `Math.random()`) rather than
 * a hand-typed literal, so the row count is exact and verifiable at a
 * glance, and so `variant: "working"` can differ from `"head"` in a
 * reviewable, formula-driven way (a few more rows + a per-row price bump)
 * instead of a second copy-pasted block that could silently drift out of
 * sync. CRITICAL invariant this generator must preserve (ARCHITECTURE.md /
 * the committed test suite): `HEAD` and `WORKING` must differ (so
 * `metrics.csv` keeps its working-tree `M` status) — guaranteed here by the
 * `variant === "working"` price/row-count deltas below, independent of the
 * exact values chosen.
 */
function generateMetricsCsv(variant: "head" | "working"): string {
  const header = [
    "id",
    "date",
    "region",
    "product",
    "category",
    "channel",
    "unit_price",
    "units_sold",
    "revenue",
    "refund_rate",
    "status",
    "campaign_url",
    "notes",
  ].join(",");

  const regions = ["us-east", "us-west", "eu-west", "eu-central", "apac-se", "apac-ne", "latam"];
  const products = [
    "Nimbus Sync",
    "Nimbus Sync Pro",
    "Ledger Lite",
    "Ledger Pro",
    "Pulse Analytics",
    "Pulse Analytics XL",
    "Vault Connect",
  ];
  const categories = ["subscription", "addon", "subscription", "addon", "analytics", "analytics", "integration"];
  const channels = ["direct", "partner", "self-serve", "enterprise-sales"];
  const statuses = ["reconciled", "pending", "reconciled", "flagged", "reconciled"];
  const notesPool = [
    "Renewal cohort -- flagged for QBR follow-up next cycle.",
    "Includes one-time onboarding credit applied at checkout.",
    "Partner-sourced lead; commission accrued separately.",
    "Backfilled from the legacy billing export -- verify against ledger.",
    "Multi-seat expansion within an existing enterprise account.",
    "Trial-to-paid conversion; first invoice in this billing period.",
    "Refund pending manual review by finance.",
  ];

  const isWorking = variant === "working";
  const rowCount = isWorking ? 42 : 40; // both comfortably clear the 40+ row requirement
  const priceBump = isWorking ? 0.3 : 0; // guarantees WORKING != HEAD content, not just row count

  const lines = [header];
  for (let i = 0; i < rowCount; i++) {
    const region = regions[i % regions.length];
    const product = products[i % products.length];
    const category = categories[i % categories.length];
    const channel = channels[i % channels.length];
    const status = statuses[i % statuses.length];
    const notes = notesPool[i % notesPool.length];

    const unitPrice = (19.99 + (i % 7) * 6.5 + priceBump).toFixed(2);
    const unitsSold = 120 + i * 17 + (i % 5) * 4;
    const revenue = (Number(unitPrice) * unitsSold).toFixed(2);
    const refundRate = ((i % 11) / 100).toFixed(3);

    const month = String(1 + (i % 12)).padStart(2, "0");
    const day = String(1 + (i % 28)).padStart(2, "0");
    const date = `2026-${month}-${day}`;
    const campaignUrl = `https://metrics.internal.example.com/campaigns/${region}/${2026000 + i}`;

    lines.push(
      [
        i + 1,
        date,
        region,
        product,
        category,
        channel,
        unitPrice,
        unitsSold,
        revenue,
        refundRate,
        status,
        campaignUrl,
        `"${notes}"`,
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

const METRICS_CSV_HEAD = generateMetricsCsv("head");
const METRICS_CSV_WORKING = generateMetricsCsv("working");

const GRAPHVIEW_TSX = `import { useMemo } from "react";
import type { IndexEntry } from "./indexer";

export interface GraphViewProps {
  entries: IndexEntry[];
}

/** Placeholder force-directed graph of the vault's link index. */
export function GraphView({ entries }: GraphViewProps) {
  const nodeCount = useMemo(() => entries.length, [entries]);
  return (
    <div data-node-count={nodeCount}>
      GraphView: {nodeCount} notes indexed.
    </div>
  );
}
`;

/**
 * DESIGN-SPEC Amendments round 3 item 21 ("Two new demo files"): a single
 * note exercising EVERY element the live-preview/rendered-markdown pipeline
 * supports — h1-h6, bold/italic/strikethrough, nested lists, task lists,
 * links (external + an internal one in the exact form
 * `editor/markdownLinks.ts`'s `resolveMarkdownLink` actually resolves —
 * `../src/indexer.ts` from `notes/`, the same relative-path shape
 * `architecture.md`'s own seeded working copy already uses), an image
 * (the existing `assets/cover.png`), nested blockquotes, inline code, fenced
 * code in several languages, a table, and horizontal rules. Committed
 * clean (see `seedVault()` below) — this is new CONTENT, not a new
 * working-tree diff, so it must never appear as a `U`/untracked or `M`
 * row (that would break the seeded git-state invariants `fs-git.spec.ts`/
 * `diffStat.test.ts`/`rich-demo-data.spec.ts` all pin: 6 changed files, 1
 * untracked).
 *
 * Note on images: this note predates Rendered mode's image support — the
 * original hand-rolled decoration switch had no `case "Image"`, so the
 * image line below rendered as plain unstyled markdown text. The
 * @atomic-editor/editor swap (2026-08-21) closed that gap (its
 * `imageBlocks` renders inline `<img>` widgets), so the fixture line now
 * exercises real image rendering. Recorded here rather than silently
 * changed.
 */
const MARKDOWN_KITCHEN_SINK_MD = `# Markdown kitchen sink

A single note exercising every element the live-preview renderer supports —
used as a manual/automated coverage fixture, not meant to read as prose.

## Headings

### H3 heading
#### H4 heading
##### H5 heading
###### H6 heading

## Emphasis

Plain text, **bold text**, *italic text*, ***bold italic***, and
~~strikethrough text~~ all in one paragraph.

## Lists

Unordered, with nesting:

- Top-level item one
  - Nested item one-a
  - Nested item one-b
    - Doubly-nested item
- Top-level item two

Ordered:

1. First step
2. Second step
3. Third step

Task list:

- [x] Wire the git status matrix into the Explorer tree
- [x] Compute the \`+12 -5\` diff chip for real
- [ ] Ship the incremental indexer's second pass
- [ ] Write the kitchen-sink coverage note (this one)

## Links

An external link to [the isomorphic-git docs](https://isomorphic-git.org/)
and an internal link to [indexer.ts](../src/indexer.ts) — resolved relative
to this note's own folder, the same way every other internal link in this
vault is.

## Images

![Vault cover art](../assets/cover.png)

## Blockquotes

> A top-level blockquote.
>
> > A nested blockquote inside it.
> >
> > > And a third level, for good measure.

## Inline code

Call \`buildIndex(paths)\` to get a fresh \`Map<string, IndexEntry>\`.

## Fenced code blocks

\`\`\`ts
export function parseLinks(source: string): string[] {
  return [...source.matchAll(/\\[[^\\]]*\\]\\(([^)]+)\\)/g)].map((m) => m[1]);
}
\`\`\`

\`\`\`json
{
  "name": "vault",
  "indexing": { "engine": "incremental" }
}
\`\`\`

\`\`\`css
.cm-md-fence {
  font-family: var(--font-mono);
  color: var(--markdown-code-color);
}
\`\`\`

\`\`\`bash
npm run build && npm test
\`\`\`

## Table

| File | Status | Lines changed |
|---|---|---|
| architecture.md | M | +12 / -5 |
| indexer.ts | M | +20 / -3 |
| GraphView.tsx | A | new file |
| legacy-parser.ts | D | removed |

## Horizontal rules

Above this line:

---

Below it, and again:

***

The end.
`;

/**
 * DESIGN-SPEC Amendments round 3 item 21: a small, simple styled HTML page
 * for the `.html` iframe preview (`renderers/HtmlPreview.tsx`) — "nothing
 * complex," per the spec. Committed clean, same invariant as the kitchen
 * sink above.
 */
const DEMO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Vault demo page</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        background: #101318;
        color: #d8dfe6;
        font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      h1 {
        color: #27d2c5;
        font-size: 24px;
      }
      p {
        color: #bac1c8;
        line-height: 1.6;
        max-width: 46ch;
      }
      .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: #1c1f26;
        color: #a8d578;
        font-family: ui-monospace, monospace;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Vault demo page</h1>
    <p>
      A small, simple static page for the sandboxed HTML preview
      (<span class="badge">sandbox=""</span>) — nothing fancy, just enough
      structure to prove the iframe renders real DOM with its own styling.
    </p>
    <p>Rendered inside an isolated <code>&lt;iframe srcDoc&gt;</code>.</p>
  </body>
</html>
`;

const INDEXER_TS_HEAD = `export function buildIndex(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const path of paths) {
    index.set(path, []);
  }
  return index;
}
`;

const INDEXER_TS_WORKING = `export interface IndexEntry {
  path: string;
  links: string[];
}

/**
 * Walks the vault and builds a sparse adjacency list, incrementally: only
 * paths touched since the last run are re-parsed.
 */
export function buildIndex(
  paths: string[],
  previous?: Map<string, IndexEntry>,
): Map<string, IndexEntry> {
  const index = previous ? new Map(previous) : new Map<string, IndexEntry>();
  for (const path of paths) {
    index.set(path, { path, links: parseLinks(path) });
  }
  return index;
}

function parseLinks(_path: string): string[] {
  // TODO: replace with the real lezer-markdown link scan (Phase 4).
  return [];
}
`;

/**
 * A second modified-code showcase, tuned for the DIFF VIEW rather than the
 * status matrix: `SEARCH_RANK_TS_HEAD` → `_WORKING` is a genuine multi-hunk
 * edit (verified with real `git diff -U3`: exactly **4 hunks, +26 −10**),
 * so unified/split mode shows several separated change regions — a top
 * import/comment+STOP_WORDS edit, a doc-comment rewrite, a scoring-core
 * rewrite, and an appended `topK` export — instead of one contiguous block.
 * Committed in the same "feat: indexing architecture draft" commit as
 * `indexer.ts` (keeps the seeded history at exactly 3 commits / ahead-3)
 * with its working copy left unstaged (one more M).
 */
const SEARCH_RANK_TS_HEAD = `// Search ranking v1 — path-substring hits plus raw link degree.

const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "or"]);

export interface ScoredNote {
  path: string;
  score: number;
}

/**
 * Ranks vault notes for a query: case-insensitive substring hits on the
 * path earn a flat boost; every inbound/outbound link adds a little.
 */
export function rankNotes(
  query: string,
  index: Map<string, string[]>,
): ScoredNote[] {
  const terms = tokenize(query);
  const results: ScoredNote[] = [];
  for (const [path, links] of index) {
    let score = 0;
    if (terms.some((t) => path.toLowerCase().includes(t))) score += 5;
    score += links.length;
    if (score > 0) results.push({ path, score });
  }
  return results.sort(byScoreDesc);
}

function byScoreDesc(a: ScoredNote, b: ScoredNote): number {
  return b.score - a.score;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}
`;

const SEARCH_RANK_TS_WORKING = `// Search ranking v2 — BM25-lite scoring over paths and link degree.

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for",
  "with", "is", "it",
]);

export interface ScoredNote {
  path: string;
  score: number;
}

/**
 * Ranks vault notes for a query with a BM25-lite heuristic: term hits in
 * the path dominate, link degree acts as a mild prior, and stop-word
 * filtering keeps short queries from matching everything in the vault.
 */
export function rankNotes(
  query: string,
  index: Map<string, string[]>,
): ScoredNote[] {
  const terms = tokenize(query);
  const results: ScoredNote[] = [];
  for (const [path, links] of index) {
    let score = 0;
    let hits = 0;
    for (const t of terms) {
      if (!path.toLowerCase().includes(t)) continue;
      hits += 1;
      score += 2 * t.length;
    }
    // Link degree as a prior: worth something, never decisive.
    score += Math.log1p(links.length);
    if (hits > 0 || links.length > 8) results.push({ path, score });
  }
  return results.sort(byScoreThenPath);
}

function byScoreThenPath(a: ScoredNote, b: ScoredNote): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.path.localeCompare(b.path);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Keeps the palette's top-N cut stable across equal scores. */
export function topK(results: ScoredNote[], k = 20): ScoredNote[] {
  return results.slice(0, k);
}
`;

/**
 * Committed (HEAD) draft of architecture.md — an earlier, shorter version.
 * Paired with `ARCHITECTURE_MD_WORKING` below, this exact pair was verified
 * against a standalone run of `my-you-eye`'s `lcsDiffFlags` (the same
 * algorithm `git/diff.ts` calls) split the same way `toLines()` splits
 * (dropping the trailing empty line a final "\n" produces): 5 removed / 12
 * added lines — matching DESIGN-SPEC's "+12 -5" exactly. Do not edit either
 * string without re-running that check; the numbers are not hardcoded
 * anywhere, they fall out of the real diff.
 */
const ARCHITECTURE_MD_HEAD = `# Indexing architecture

The indexer walks vault files and builds a lookup table on load.

## Constraints

- Index must finish before the UI unblocks
- Full rebuild on every note change
- Legacy parser stays a fallback

## Pipeline

Rebuild everything on save.
`;

const ARCHITECTURE_MD_WORKING = `# Indexing architecture

The vault indexer walks the file graph and emits a sparse adjacency list. See [indexer.ts](../src/indexer.ts) for the walker.

## Constraints

- Cold index of 50k notes under \`900ms\`
- Incremental updates are **append-only**
- No blocking work on the render thread

> Treat the index as a cache. Never as truth.

## Pipeline

\`\`\`
walk(root) → parse() → link() → commit()
\`\`\`

## Rollback
Every commit is content-addressed, so a bad update reverts by replaying the commit log backwards.
`;

async function commitPaths(filepaths: string[], message: string): Promise<void> {
  for (const filepath of filepaths) {
    await git.add({ fs, dir: GIT_DIR, filepath });
  }
  await git.commit({ fs, dir: GIT_DIR, message, author: DEMO_AUTHOR });
}

async function seedVault(): Promise<void> {
  await git.init({ fs, dir: GIT_DIR, defaultBranch: DEFAULT_BRANCH });

  // Write every baseline file's on-disk content up front, in the exact
  // order DESIGN-SPEC §3 lists the tree (used by useFsStore's canonical
  // sibling order) — independent of which commit each file lands in below.
  await writeFile(`${VAULT_DIR}/notes/reading-list.md`, READING_LIST_MD);
  await writeFile(`${VAULT_DIR}/notes/architecture.md`, ARCHITECTURE_MD_HEAD);
  await writeFile(`${VAULT_DIR}/src/theme.css`, THEME_CSS);
  await writeFile(`${VAULT_DIR}/src/indexer.ts`, INDEXER_TS_HEAD);
  await writeFile(`${VAULT_DIR}/src/searchRank.ts`, SEARCH_RANK_TS_HEAD);
  await writeFile(`${VAULT_DIR}/src/legacy-parser.ts`, LEGACY_PARSER_TS);
  await writeFile(`${VAULT_DIR}/assets/cover.png`, coverPngBytes());
  await writeFile(`${VAULT_DIR}/metrics.csv`, METRICS_CSV_HEAD);
  await writeFile(`${VAULT_DIR}/vault.config.json`, VAULT_CONFIG_JSON);
  // DESIGN-SPEC Amendments round 3 item 21: both new demo files are
  // written and committed alongside every other clean, untouched file
  // (`reading-list.md`, `theme.css`, `vault.config.json`, `cover.png`) —
  // they must land COMMITTED, never left staged/untracked, or they'd
  // silently inflate the seeded "6 changed files" / "1 untracked" git-state
  // invariants every other spec in this suite pins.
  await writeFile(`${VAULT_DIR}/notes/markdown-kitchen-sink.md`, MARKDOWN_KITCHEN_SINK_MD);
  await writeFile(`${VAULT_DIR}/demo.html`, DEMO_HTML);

  // Three real commits — a small, real history rather than one big blob.
  await commitPaths(
    ["src/theme.css", "src/legacy-parser.ts", "notes/reading-list.md", "vault.config.json", "assets/cover.png"],
    "chore: scaffold vault",
  );
  await commitPaths(
    ["notes/architecture.md", "src/indexer.ts", "src/searchRank.ts", "metrics.csv"],
    "feat: indexing architecture draft",
  );
  await commitPaths(
    ["notes/markdown-kitchen-sink.md", "demo.html"],
    "docs: markdown kitchen sink + html preview demo",
  );

  // Working-tree edits, left uncommitted, so statusMatrix() genuinely
  // reports M/A/D/U per DESIGN-SPEC §3 — nothing here is a hardcoded label.
  await writeFile(`${VAULT_DIR}/notes/architecture.md`, ARCHITECTURE_MD_WORKING); // M (unstaged)
  await writeFile(`${VAULT_DIR}/src/indexer.ts`, INDEXER_TS_WORKING); // M (unstaged)
  await writeFile(`${VAULT_DIR}/src/searchRank.ts`, SEARCH_RANK_TS_WORKING); // M (unstaged) — multi-hunk diff showcase
  await writeFile(`${VAULT_DIR}/metrics.csv`, METRICS_CSV_WORKING); // M (unstaged)
  await removePath(`${VAULT_DIR}/src/legacy-parser.ts`); // D (unstaged)

  await writeFile(`${VAULT_DIR}/src/GraphView.tsx`, GRAPHVIEW_TSX);
  await git.add({ fs, dir: GIT_DIR, filepath: "src/GraphView.tsx" }); // A (staged, uncommitted)

  await writeFile(`${VAULT_DIR}/notes/daily-2026-08-14.md`, DAILY_NOTE_MD); // U (never staged)
}

const WELCOME_MD = `# Welcome to VSNote

This is your vault. Everything lives in your browser, so it stays private to
you and keeps working offline.

## Getting started

- Right-click in the file tree to add a file or folder.
- Drag files in from your desktop, or paste them with Ctrl+V.
- Press Cmd+K (Ctrl+K) for the command palette.
- Markdown renders as you type. Toggle raw source from the editor header.

Your vault is a real git repository, so the Source Control panel shows real
diffs and history from the first edit you make.

Want the full tour? Run "Load demo vault" from the command palette. It
replaces this vault with a showcase one.
`;

/**
 * DESIGN-SPEC Amendments round 5 item 36 — a default first boot seeds this
 * minimal vault instead of the showcase one above: a single `welcome.md`,
 * committed clean, on a real git repo so Source Control still works from
 * the first edit. Deliberately ONE file: the point of the amendment is that
 * a new user's vault is theirs, not a pile of demo content they have to
 * delete.
 */
async function seedWelcomeVault(): Promise<void> {
  await git.init({ fs, dir: GIT_DIR, defaultBranch: DEFAULT_BRANCH });
  await writeFile(`${VAULT_DIR}/welcome.md`, WELCOME_MD);
  await commitPaths(["welcome.md"], "chore: welcome to VSNote");
}

/**
 * Whether this BUILD ships the full demo vault (DESIGN-SPEC item 36).
 * `__VSNOTE_DEMO_VAULT__` is vite `define`d from the `VSNOTE_DEMO_VAULT` env
 * var — see vite.config.ts and src/env.d.ts. Exported so the UI can label
 * the reset command for whichever mode is active.
 */
export function isDemoVaultBuild(): boolean {
  return __VSNOTE_DEMO_VAULT__;
}

/** Safe to call on every boot — no-ops if the repo already exists. Seeds
 * the demo vault only on a demo build; otherwise the minimal welcome vault
 * (item 36). */
export async function ensureSeeded(): Promise<void> {
  const alreadySeeded = await pathExists(`${VAULT_DIR}/.git`);
  if (alreadySeeded) return;
  if (isDemoVaultBuild()) {
    await seedVault();
    return;
  }
  await seedWelcomeVault();
}

/**
 * Wipes the filesystem and reseeds from scratch, staying coherent with
 * whichever mode this build is in (item 36): a demo build resets to the
 * demo vault, a normal build resets to the welcome vault. Wired to the
 * command palette's reset command.
 */
export async function resetVault(): Promise<void> {
  resetFilesystem();
  if (isDemoVaultBuild()) {
    await seedVault();
    return;
  }
  await seedWelcomeVault();
}

/**
 * Explicitly replaces the current vault with the full demo vault, whatever
 * the build flag says (item 36's "Load demo vault" palette command). The
 * caller is responsible for warning the user first: this destroys the
 * current vault, including its git history.
 */
export async function loadDemoVault(): Promise<void> {
  resetFilesystem();
  await seedVault();
}
