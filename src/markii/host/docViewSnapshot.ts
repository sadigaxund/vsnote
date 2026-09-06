/**
 * Phase M3, defect fix (found in review before this phase shipped):
 * `@markii/runtime`'s `DocView` (`doc.ts`) carries a `value(name)` METHOD,
 * and `runDocumentScripts` builds one UNCONDITIONALLY for every script it
 * runs — "Absent [`options.doc`], scripts still get a `doc` view, with an
 * empty listing" (`run.d.ts`'s own doc comment). A function property makes
 * the whole object non-structured-cloneable, so `WorkerRunner.run`
 * `postMessage`-ing a real `DocView` straight into
 * `scriptIsolate.worker.ts` throws `DataCloneError` on every single script
 * `runDocumentScripts` executes — not an edge case, the normal path.
 *
 * The fix does not touch `@markii/runtime` (it is correct: a synchronous,
 * host-thread `DocView` is the right contract for an in-process executor).
 * Instead, this module is the boundary that converts a real `DocView` into
 * a plain, cloneable `DocViewSnapshot` BEFORE it ever reaches a
 * `ScriptIsolate.run` call (`runScripts.ts`'s executor wrapper does this on
 * every call), so `ScriptIsolate`'s own port contract
 * (`host/types.ts`) never mentions the un-cloneable `DocView` type at all —
 * every concrete isolate, present or future, receives something safe to
 * move across a process/worker boundary by construction, not by
 * convention.
 *
 * Why a snapshot is even possible: `DocView.value(name)`'s answer is fully
 * determined at the moment `runDocumentScripts` calls the executor for one
 * script (see `doc.ts`'s own doc comment: "a name some earlier script in
 * this run already produced reads back as that value; a name belonging to
 * a script at or after the caller's own position is refused; anything else
 * is simply nil") — it can never change later in that same call, and it can
 * only ever answer non-nil for one of the note's OWN script names. That
 * makes it possible to precompute the answer for every script name once,
 * on the thread where the real `DocView` lives, and ship the finite result
 * table instead of a live callback.
 *
 * `reconstructDocView` is the receiving side, called ONLY inside the actual
 * isolate boundary (e.g. inside the Worker, immediately before handing a
 * real `DocView` to `@markii/lua`'s `createLuaExecutor`) — never on the
 * sending side, and never crossing a message boundary itself.
 */
import type { DirectiveListing, DocValueRead, DocView } from "@markii/runtime";

export interface DocViewSnapshot {
  directives: DirectiveListing;
  /**
   * One entry per note script NAME (not per occurrence — a note with two
   * script blocks sharing a name has one answer per `DocView`'s own
   * by-name lookup, regardless of how many blocks share it). A `ReadonlyMap`
   * rather than a plain object: the structured clone algorithm supports
   * `Map` natively, and a `Map` cannot suffer prototype-pollution the way a
   * plain-object lookup keyed by a user-authored script name could
   * (`"__proto__"`, `"constructor"`, ...).
   */
  values: ReadonlyMap<string, DocValueRead>;
}

/**
 * Precomputes a cloneable snapshot of `doc`, for every name in
 * `scriptNames` (typically every script name in the note, deduplicated).
 * Pure with respect to `doc` itself: `DocView.value` is documented as
 * side-effect-free, so calling it once per unique name here is safe to do
 * eagerly rather than lazily.
 */
export function buildDocViewSnapshot(doc: DocView, scriptNames: readonly string[]): DocViewSnapshot {
  const values = new Map<string, DocValueRead>();
  for (const name of scriptNames) {
    if (values.has(name)) continue;
    values.set(name, doc.value(name));
  }
  return { directives: doc.directives, values };
}

/**
 * Rebuilds a real `DocView` from a snapshot — `value(name)` becomes a
 * synchronous `Map` lookup, defaulting to `{ ok: true, value: undefined }`
 * (nil) for any name the snapshot has no entry for, matching `DocView`'s
 * own documented "anything else is simply nil" default for a name that
 * belongs to no script at all. Never invents a new refusal shape: a name
 * that WAS captured as a rejection (`{ ok: false, message }`) is returned
 * exactly as captured, not reinterpreted.
 */
export function reconstructDocView(snapshot: DocViewSnapshot): DocView {
  return {
    directives: snapshot.directives,
    value(name) {
      return snapshot.values.get(name) ?? { ok: true, value: undefined };
    },
  };
}
