/**
 * Guard for the store-subscription hygiene invariant (COMPONENT-BACKLOG
 * §3.1) — the zustand counterpart of `fsIsolation.test.ts`'s static-scan
 * approach.
 *
 * Two regression shapes it pins:
 *
 * 1. **Whole-store subscriptions** (`useTabsStore()` with no selector) in
 *    a component re-render that component on EVERY store change — the
 *    typing-latency bug class DESIGN-SPEC Amendments item 16 fixed for
 *    `fs`/`buffers` and §3.1 finished for git/tabs in `App.tsx`. Actions
 *    must be read via `getState()` at call time instead.
 * 2. **Fresh-reference selectors** (`(s) => ({ a: s.a })`,
 *    `(s) => s.x.filter(...)`) under zustand v5's default `Object.is`
 *    equality — a new object/array identity every call re-renders the
 *    subscriber on every store tick and can even loop when combined with
 *    effect deps. Select primitives, or pass a shallow-equality fn.
 *
 * Static text scan, deliberately dumb: it can't prove a hit is a real
 * violation, so it errs loud — add a narrowly-scoped allowlist entry with
 * a reason if a flagged line is actually fine.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "../../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name.name)) out.push(p);
  }
  return out;
}

describe("store subscription hygiene (COMPONENT-BACKLOG §3.1)", () => {
  const files = walk(SRC);

  it("no whole-store subscriptions (selector-less use*Store() calls)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
        if (/\buse[A-Z]\w*Store\(\s*\)/.test(line)) {
          offenders.push(`${f.replace(SRC, "src")}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Whole-store subscriptions re-render on every store change. Read fields via a\n` +
        `targeted selector and actions via getState() at call time (see App.tsx's §3.1\n` +
        `block):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no fresh-object/array selectors under Object.is equality", () => {
    const offenders: string[] = [];
    const patterns = [
      /\(\s*s\s*\)\s*=>\s*\(\s*\{/, // (s) => ({ ... })
      /\(\s*s\s*\)\s*=>\s*[^,\n)]*\.(map|filter|slice)\(/, // (s) => s.x.map(...)
    ];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
        if (!/use[A-Z]\w*Store\(/.test(line)) return;
        for (const pat of patterns) {
          if (pat.test(line)) offenders.push(`${f.replace(SRC, "src")}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Selectors returning fresh objects/arrays defeat zustand v5's Object.is equality\n` +
        `(re-render every tick, possible render loops). Select primitives or pass a\n` +
        `shallow-equality function:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
