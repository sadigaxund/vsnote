/**
 * Deterministic stress-fixture generators for DESIGN-SPEC Amendments item 33
 * (big-file safety, CSV/JSON renderers). No randomness — same output every
 * run, so `tests/unit/rendererBigFileCaps.test.ts` stays reproducible
 * without checking in multi-megabyte fixture files on disk.
 */

/** A ~50k-row CSV: 7 columns mixing id/number/date/url/text types, matching
 * `CsvTable`'s column-type-inference cases (numeric, ISO date, URL, text). */
export function generateStressCsv(rows: number): string {
  const header = "id,name,email,created,amount,url,notes\n";
  let body = "";
  for (let i = 0; i < rows; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    body += `${i},user-${i},user${i}@example.com,2026-01-${day},${(i * 1.5).toFixed(2)},https://example.com/u/${i},note text for row ${i}\n`;
  }
  return header + body;
}

/** A flat JSON array of `count` small objects — exercises BREADTH at a
 * single (root) level. */
export function generateWideJson(count: number): string {
  const arr: unknown[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({ id: i, name: `item-${i}`, active: i % 2 === 0, tags: ["a", "b"] });
  }
  return JSON.stringify(arr);
}

/** A single-child chain `depth` levels deep — exercises DEPTH with no
 * breadth at any level. */
export function generateDeepJson(depth: number): string {
  let obj: unknown = { leaf: true, value: 42 };
  for (let i = 0; i < depth; i++) obj = { level: i, child: obj };
  return JSON.stringify(obj);
}

/** A moderately-wide array of moderately-deep records — the "large AND
 * deeply-nested" combined fixture DESIGN-SPEC item 33 asks for explicitly. */
export function generateLargeDeepJson(items: number, chainDepth: number): string {
  const arr: unknown[] = [];
  for (let i = 0; i < items; i++) {
    let node: unknown = { id: i, values: Array.from({ length: 10 }, (_, j) => j) };
    for (let d = 0; d < chainDepth; d++) node = { depth: d, inner: node };
    arr.push(node);
  }
  return JSON.stringify(arr);
}

/** An object bushy at every one of `levels` levels (branching factor
 * `branching` at each) — the pathological worst case for pure per-level
 * breadth capping, which multiplies rather than adds across levels. Keep
 * `branching`/`levels` modest (e.g. 60/3 ~= 216,000 leaves) — much beyond
 * that and even generating/`JSON.stringify`-ing the raw fixture OOMs Node,
 * independent of anything this app does with it. */
export function generateBushyJson(branching: number, levels: number): string {
  function level(d: number): unknown {
    if (d === 0) return "leaf";
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < branching; i++) obj[`k${i}`] = level(d - 1);
    return obj;
  }
  return JSON.stringify(level(levels));
}
