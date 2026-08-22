/**
 * UI copy: error-toast standards (docs/UI-STANDARDS.md rule 3, TODO §7.5).
 *
 * Static scan over all src tsx files for `toast({ ... variant: "danger" })`
 * literals. Every danger toast must:
 *
 *  - carry a non-empty `description` (the title alone can't hold the
 *    "[What failed]. [Why]. [Next step]." template),
 *  - never use the banned filler phrases ("something went wrong",
 *    "invalid …", exclamation marks) that tell the user nothing.
 *
 * Same static-scan discipline as fsIsolation/storeSelectorHygiene: dumb
 * regexes, loud failures, allowlist by editing this file with a reason.
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
    else if (/\.tsx$/.test(name.name)) out.push(p);
  }
  return out;
}

/** Captures a full `toast({ … })` call including balanced braces. */
function extractToastCalls(source: string): { block: string; line: number }[] {
  const calls: { block: string; line: number }[] = [];
  const start = /toast\(\{\n?/.exec(source);
  void start;
  const re = /toast\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    calls.push({ block: source.slice(m.index, i), line: source.slice(0, m.index).split("\n").length });
  }
  return calls;
}

const BANNED = [/something went wrong/i, /\bInvalid\b/, /!"/];

describe("danger-toast copy standards (TODO §7.5)", () => {
  const files = walk(SRC);
  const violations: string[] = [];

  it("every danger toast has a description and no banned filler", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const rel = f.replace(SRC, "src");
      for (const call of extractToastCalls(src)) {
        if (!/variant:\s*"danger"/.test(call.block)) continue;
        const desc = /description:\s*([^,]+),/.exec(call.block)?.[1]?.trim() ?? "";
        if (!desc || desc === '""') {
          violations.push(`${rel}:${call.line} danger toast without description`);
        }
        const text = call.block;
        for (const banned of BANNED) {
          if (banned.test(text)) {
            violations.push(`${rel}:${call.line} banned phrase ${banned} in danger toast`);
          }
        }
      }
    }
    expect(
      violations,
      `Danger toasts must follow docs/UI-STANDARDS.md rule 3\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
