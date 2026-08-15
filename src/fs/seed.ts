/**
 * Idempotent demo-vault seeder. Reproduces every state DESIGN-SPEC §3 /
 * "Git features" describes as REAL isomorphic-git history + working-tree
 * edits, not hardcoded status letters:
 *
 *  - two real commits on `feat/incremental-index`
 *  - `architecture.md` modified unstaged (M) — its committed vs working
 *    content is hand-authored so `git/diff.ts`'s real LCS diff genuinely
 *    computes +12 -5 (verified with the exact production `toLines()`
 *    splitting logic before being written here; see the module comment on
 *    `ARCHITECTURE_MD_HEAD`/`_WORKING` below)
 *  - `indexer.ts`, `metrics.csv` modified unstaged (M)
 *  - `legacy-parser.ts` deleted from the working tree, unstaged (D)
 *  - `GraphView.tsx` written + staged, never committed (A)
 *  - `daily-2026-08-14.md` written, never staged (U)
 *  - `reading-list.md`, `theme.css`, `vault.config.json`, `assets/cover.png`
 *    committed and left untouched (no status letter)
 *
 * `ensureSeeded()` is safe to call on every boot: it checks for
 * `/vault/.git` and no-ops if the repo already exists. `resetDemoVault()`
 * wipes the IndexedDB-backed filesystem and reseeds from scratch — exported
 * for the command palette to wire up in Phase 5, per IMPLEMENTATION-PLAN.md
 * Phase 2's "a 'Reset demo vault' function re-seeds from scratch (wiring it
 * to the command palette is Phase 5 — just export it)".
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

const VAULT_CONFIG_JSON = `{
  "name": "vault",
  "theme": "slate-dark",
  "defaultMode": {
    "md": "rendered",
    "ts": "source",
    "tsx": "source",
    "json": "source",
    "css": "source",
    "csv": "source"
  }
}
`;

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

const METRICS_CSV_HEAD = `metric,value
cold_index_ms,1400
notes_indexed,41823
`;

const METRICS_CSV_WORKING = `metric,value
cold_index_ms,873
notes_indexed,50214
incremental_p95_ms,42
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
  await writeFile(`${VAULT_DIR}/src/legacy-parser.ts`, LEGACY_PARSER_TS);
  await writeFile(`${VAULT_DIR}/assets/cover.png`, coverPngBytes());
  await writeFile(`${VAULT_DIR}/metrics.csv`, METRICS_CSV_HEAD);
  await writeFile(`${VAULT_DIR}/vault.config.json`, VAULT_CONFIG_JSON);

  // Two real commits — a small, real history rather than one big blob.
  await commitPaths(
    ["src/theme.css", "src/legacy-parser.ts", "notes/reading-list.md", "vault.config.json", "assets/cover.png"],
    "chore: scaffold vault",
  );
  await commitPaths(
    ["notes/architecture.md", "src/indexer.ts", "metrics.csv"],
    "feat: indexing architecture draft",
  );

  // Working-tree edits, left uncommitted, so statusMatrix() genuinely
  // reports M/A/D/U per DESIGN-SPEC §3 — nothing here is a hardcoded label.
  await writeFile(`${VAULT_DIR}/notes/architecture.md`, ARCHITECTURE_MD_WORKING); // M (unstaged)
  await writeFile(`${VAULT_DIR}/src/indexer.ts`, INDEXER_TS_WORKING); // M (unstaged)
  await writeFile(`${VAULT_DIR}/metrics.csv`, METRICS_CSV_WORKING); // M (unstaged)
  await removePath(`${VAULT_DIR}/src/legacy-parser.ts`); // D (unstaged)

  await writeFile(`${VAULT_DIR}/src/GraphView.tsx`, GRAPHVIEW_TSX);
  await git.add({ fs, dir: GIT_DIR, filepath: "src/GraphView.tsx" }); // A (staged, uncommitted)

  await writeFile(`${VAULT_DIR}/notes/daily-2026-08-14.md`, DAILY_NOTE_MD); // U (never staged)
}

/** Safe to call on every boot — no-ops if the repo already exists. */
export async function ensureSeeded(): Promise<void> {
  const alreadySeeded = await pathExists(`${VAULT_DIR}/.git`);
  if (alreadySeeded) return;
  await seedVault();
}

/** Wipes the filesystem and reseeds from scratch. Exported for the Phase 5
 * command palette's "Reset demo vault" command. */
export async function resetDemoVault(): Promise<void> {
  resetFilesystem();
  await seedVault();
}
