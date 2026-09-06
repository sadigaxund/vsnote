/**
 * Phase M3 — `runScripts`: the one explicit, platform-agnostic entry point
 * for actually executing a `.mk.md` note's scripts. Nothing in this module
 * may be called from a render path; `@markii/react`'s render tree only ever
 * reads whatever a PREVIOUS `runScripts` call already wrote to persisted
 * values ("rendering is pure; running is an event" — docs/scripting.md).
 *
 * Orchestration, in order:
 * 1. `@markii/core`'s `parse` + `extractScripts` — pure AST inspection.
 * 2. Hydrate a `ValueStore` from whatever was persisted for this note path
 *    last time (`valuePersistence.ts`; stale-marked, never claimed fresh).
 * 3. `tierForTrigger` (via `capabilities.ts`, which re-derives it itself
 *    rather than trusting a passed-in tier) decides `'manual'` vs `'auto'`.
 * 4. For a MANUAL trigger only: compute this note's grant key
 *    (`grantClosure.ts`), consult `deps.grantStore.get(key)`, and if no
 *    valid grant exists, call `deps.grantPrompt(...)` exactly once and
 *    persist an accepted decision via `grantStore.set`. `auto`/`scheduled`
 *    NEVER reach this branch at all — no prompt, no grant lookup, nothing
 *    that could surprise a user who merely opened or auto-refreshed a note.
 * 5. Build the tier-appropriate capability config (`capabilities.ts`) and
 *    hand it to `deps.isolateFactory` to construct a fresh `ScriptIsolate`
 *    for this run.
 * 6. `runDocumentScripts` (`@markii/runtime`) drives the actual sequential
 *    execution against that isolate, through an executor wrapper that
 *    converts the real (function-carrying, non-cloneable) `DocView` it
 *    hands us into a plain `DocViewSnapshot` before ever calling
 *    `isolate.run` — see `docViewSnapshot.ts`'s module doc for why this
 *    conversion has to happen here, at the port boundary, not inside any
 *    one concrete isolate.
 * 7. Persist the resulting snapshot back via `deps.savePersistedValues`,
 *    regardless of whether every script succeeded — a batch with some
 *    failures still has real successful values worth keeping.
 * 8. `isolate.dispose()` in a `finally`, so a worker is never leaked even if
 *    something above throws (it shouldn't — every dependency here documents
 *    itself as non-throwing — but a host-supplied `deps` function is not
 *    under this module's control).
 */
import { parse, extractScripts, type ScriptBlock } from "@markii/core";
import {
  runDocumentScripts,
  tierForTrigger,
  type RunSummary,
  type RunTrigger,
  type ScriptExecutor,
  type StoredValue,
} from "@markii/runtime";
import { computeNoteGrantKey } from "./grantClosure";
import { buildCapabilityConfig, type CapabilityConfig } from "./capabilities";
import { buildDocViewSnapshot } from "./docViewSnapshot";
import { hydrateValueStore, snapshotForPersist } from "./valuePersistence";
import {
  DEFAULT_DENY_PROMPT,
  type GrantPrompt,
  type GrantStore,
  type NetProvider,
  type ScriptIsolate,
} from "./types";

export interface RunScriptsDeps {
  /** Constructs a fresh, tier-scoped `ScriptIsolate` for one `runScripts` call. Never reused across calls: a note's grants/tier can differ between runs, so a new isolate (and, per `watchdog.ts`, a new underlying worker on first use) is built every time. */
  isolateFactory: (config: CapabilityConfig) => ScriptIsolate;
  /** The host's real network primitive. Omitted, no script in this note can ever reach the network, at any tier. */
  netProvider?: NetProvider;
  grantStore: GrantStore;
  /** Defaults to `DEFAULT_DENY_PROMPT` (deny everything) when omitted — see that constant's doc comment. */
  grantPrompt?: GrantPrompt;
  loadPersistedValues: (path: string) => Promise<Record<string, StoredValue> | undefined>;
  savePersistedValues: (path: string, values: Record<string, StoredValue>) => Promise<void>;
  /** Resolves a `src=` long-script reference to its source text (docs/scripting.md). Omitted, a `src=` block simply errors as that one script's failure; other blocks in the same batch still run. */
  loadSource?: (src: string) => Promise<string> | string;
}

/**
 * Parses `text`, extracts and runs its script blocks at the tier `trigger`
 * implies, and persists the resulting values keyed by `path`. Never throws
 * (every dependency it calls is documented as non-throwing); returns the
 * `RunSummary` `@markii/runtime` produced.
 */
export async function runScripts(
  path: string,
  text: string,
  trigger: RunTrigger,
  deps: RunScriptsDeps,
): Promise<RunSummary> {
  const tree = parse(text);
  const scripts: ScriptBlock[] = extractScripts(tree);

  const persisted = await deps.loadPersistedValues(path);
  const store = hydrateValueStore(persisted);

  const tier = tierForTrigger(trigger);
  const permissions = tier === "manual" ? await resolveManualPermissions(path, scripts, deps) : undefined;

  const capabilityConfig = buildCapabilityConfig({ trigger, permissions, netProvider: deps.netProvider });
  const isolate = deps.isolateFactory(capabilityConfig);

  const scriptNames = scripts.map((s) => s.name);

  try {
    // `runDocumentScripts` hands the executor a REAL `@markii/runtime`
    // `DocView` (a function-carrying object — see `docViewSnapshot.ts`'s
    // module doc for why that is non-structured-cloneable) unconditionally,
    // for every script. This wrapper is the boundary: it converts that
    // `DocView` into a plain `DocViewSnapshot` before it ever reaches
    // `isolate.run`, so every `ScriptIsolate` implementation — including a
    // Worker-backed one that must `postMessage` this across a real
    // boundary — receives something safe to clone, never the function-
    // carrying original.
    const executor: ScriptExecutor = (input) =>
      isolate.run({
        code: input.code,
        tier: input.tier,
        doc: input.doc ? buildDocViewSnapshot(input.doc, scriptNames) : undefined,
      });
    const summary = await runDocumentScripts({
      scripts,
      executor,
      trigger,
      store,
      loadSource: deps.loadSource,
    });
    await deps.savePersistedValues(path, snapshotForPersist(store));
    return summary;
  } finally {
    isolate.dispose();
  }
}

/** Manual-tier-only grant resolution — see module doc step 4. Never called for `auto`/`scheduled`. */
async function resolveManualPermissions(
  path: string,
  scripts: ScriptBlock[],
  deps: RunScriptsDeps,
) {
  const grantKey = await computeNoteGrantKey(scripts);
  const existing = await deps.grantStore.get(grantKey);
  if (existing) return existing.permissions;

  const prompt = deps.grantPrompt ?? DEFAULT_DENY_PROMPT;
  const decision = await prompt({ path, grantKey, scripts });
  if (!decision.granted) return undefined;

  await deps.grantStore.set({ key: grantKey, path, permissions: decision.permissions, grantedAt: Date.now() });
  return decision.permissions;
}
