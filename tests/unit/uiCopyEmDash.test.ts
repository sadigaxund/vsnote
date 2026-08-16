/**
 * Regression guard for DESIGN-SPEC Amendments round 4 item 28 (global,
 * permanent rule): hints, tooltips, and setting descriptions are ONE ROW,
 * concise, and carry ZERO em dashes ("—") — drop details rather than wrap.
 * This test is the guard, not the sweep itself (the sweep already happened
 * across `src/` in this same phase, see git history) — it scans every
 * `.ts`/`.tsx` file under `src/` for a literal em dash OUTSIDE comments and
 * fails, naming the offending file/line/string, so a dash-joined hint
 * can't silently slip back in later.
 *
 * DETECTION RULE: strip `/* ... *\/` block comments (this regex also
 * removes JSX `{/* ... *\/}` comments — the leftover `{`/`}` braces are
 * harmless once their content is gone) file-wide, replacing each match
 * with the same number of newlines it contained (so line numbers in a
 * reported violation still match the real file); THEN strip trailing `//`
 * line comments per remaining line. Whatever's left is treated as "code" —
 * a line containing "—" after that is a violation, whether it's a JSX text
 * child, a string prop (`title=`/`hint=`/`tooltip=`/`description=`/etc.),
 * or a plain string/template-literal constant used as copy (the
 * `SHORTCUTS` table, a `SyncError` message, a toast title — none of those
 * are distinguished from "code" by this scan, deliberately: anything that
 * ISN'T a comment is fair game, since a raw string constant is exactly as
 * likely to end up on screen as a JSX prop is).
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH (false negatives, stated honestly
 * rather than silently) — a guard with obvious blind spots is only useful
 * if the blind spots are on record:
 *   - The `//` line-comment strip is a heuristic (`(^|\s)//.*$`, only
 *     treating `//` as a comment start when preceded by start-of-line or
 *     whitespace, specifically so it does NOT eat `https://` mid-string),
 *     not a real tokenizer. A string literal that itself contains the
 *     two-character sequence " //" would have everything after it
 *     silently dropped from the scan, including any em dash past that
 *     point on the same line.
 *   - The block-comment strip is a single regex over the whole file, not a
 *     parser — a `/*` or `*\/` sequence appearing INSIDE a string literal
 *     (this codebase has none today) would desync it, either eating real
 *     code as "comment" or leaving a real comment's em dash exposed.
 *   - `src/fs/seed.ts` is excluded entirely: its em dashes live inside
 *     SEEDED VAULT DOCUMENT content (fake notes/changelog text a demo user
 *     "wrote" into the sample vault), not app chrome copy — item 28
 *     governs hints/tooltips/descriptions the app itself renders as UI,
 *     not the text of documents the app happens to display.
 *   - Doesn't understand runtime string assembly — it only sees literal
 *     em dash characters present in the source text. A dash pieced
 *     together from separate variables/concatenation at runtime (this
 *     codebase has none today) would slip through.
 *   - Scans `src/` only — not `server/` (Python, a different language and
 *     review surface) or `docs/`. This rule is specifically about the
 *     CLIENT's rendered UI copy.
 *   - Doesn't distinguish "is this actually user-facing" from "is this
 *     just an internal constant that happens to hold a string" — a
 *     non-UI internal-only string with an em dash (none exist today) would
 *     also be flagged, which is a false POSITIVE, not a negative, but is
 *     worth naming: this guard is deliberately over-inclusive on the "is
 *     it code" side and relies entirely on the comment-stripping to carve
 *     out the "not UI copy" exception, rather than an allowlist of
 *     copy-shaped prop names (which would under-catch plain string
 *     constants like `SHORTCUTS`/`SyncError` messages instead).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(__dirname, "../../src");

// Seeded vault DOCUMENT content, not app chrome — see the module doc above.
const EXCLUDED_RELATIVE_PATHS = new Set(["fs/seed.ts"]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (entry.endsWith(".d.ts")) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (!/\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  // Block comments (incl. JSX `{/* ... */}`) — replaced with an equal
  // count of newlines so every later line NUMBER still lines up with the
  // real file (a naive empty-string replace would shift them).
  const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) ?? []).length));
  // Trailing `//` line comments — only when preceded by start-of-line or
  // whitespace, so `https://` mid-string survives.
  return noBlockComments
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

describe("UI copy: zero em dashes (DESIGN-SPEC Amendments round 4 item 28)", () => {
  it("no em dash outside comments anywhere in src/**/*.ts(x)", () => {
    const files = collectSourceFiles(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file).split("\\").join("/");
      if (EXCLUDED_RELATIVE_PATHS.has(rel)) continue;
      const stripped = stripComments(readFileSync(file, "utf-8"));
      stripped.split("\n").forEach((line, idx) => {
        if (line.includes("—")) {
          violations.push(`src/${rel}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations, `Found em dash(es) ("—") in UI copy — rewrite as one concise row with no dash:\n${violations.join("\n")}`).toEqual([]);
  });
});
