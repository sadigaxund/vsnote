/**
 * Phase 11 (real sync, roadmap §5.3) — the commit-message template engine.
 * Pure string logic, no `isomorphic-git`/`fs` dependency, so it's directly
 * unit-testable (`tests/unit/commitTemplate.test.ts`): `renderCommitTemplate`
 * substitutes `{device}`/`{timestamp}`/`{date}`/`{time}`/`{files}`/`{branch}`
 * into a user-editable template string, and `defaultDeviceName` derives the
 * `{device}` SETTING's own default from the UA (browsers can't read a real
 * hostname — roadmap §5.3's own reasoning).
 *
 * Consumers: `SourceControlPanel.tsx` prefills the commit box from
 * `useSettingsStore`'s `gitCommitTemplate`/`gitDeviceName` (editable per-
 * commit before the user hits Commit); `useGitStore.ts`'s `syncNow` uses
 * the same template for one-click Sync's auto-commit of uncommitted
 * changes AND (via `sync.ts`) for merge-commit messages.
 */

export interface TemplateVarsInput {
  device: string;
  branch: string;
  /** Display paths (or bare filenames — callers may pass either; only
   * `.length` and, for the single-file case, the LAST path segment are
   * used) of every file the resulting commit covers. */
  files: string[];
  /** Injectable for tests; defaults to `new Date()` (local time — roadmap
   * §5.3: "`{timestamp}` — local `YYYY-MM-DD HH:mm`"). */
  now?: Date;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD`, local time. */
export function formatDatePart(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `HH:mm`, local time, 24h. */
export function formatTimePart(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `YYYY-MM-DD HH:mm`, local time — roadmap §5.3's `{timestamp}`. */
export function formatTimestamp(d: Date): string {
  return `${formatDatePart(d)} ${formatTimePart(d)}`;
}

/** `{files}` — roadmap §5.3: `"N files"`, or the single filename (not the
 * full path — a commit message is a one-liner, the directory adds nothing
 * a `git show --stat` doesn't already say) when exactly one file changed.
 * `files: []` (nothing changed — e.g. a merge with zero touched paths,
 * theoretically unreachable but not worth a throw over) renders `"0
 * files"` rather than special-casing it into something misleading. */
export function formatFilesLabel(files: string[]): string {
  if (files.length === 1) {
    const path = files[0];
    const lastSlash = path.lastIndexOf("/");
    return lastSlash === -1 ? path : path.slice(lastSlash + 1);
  }
  return `${files.length} files`;
}

/** Assembles the full variable map `renderCommitTemplate` substitutes. */
export function buildTemplateVars({ device, branch, files, now = new Date() }: TemplateVarsInput): Record<string, string> {
  return {
    device,
    timestamp: formatTimestamp(now),
    date: formatDatePart(now),
    time: formatTimePart(now),
    files: formatFilesLabel(files),
    branch,
  };
}

/**
 * Substitutes `{name}` tokens in `template` from `vars`. Roadmap §5.3:
 * "Unknown `{vars}` pass through literally — never error" — a token whose
 * name isn't a key in `vars` (typo, a variable this app doesn't define,
 * even a bare `{}`) is left in the output byte-for-byte rather than
 * throwing or silently dropping it; there is no way to call this with an
 * input that errors.
 */
export function renderCommitTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]*)\}/g, (match, name: string) => (name in vars ? vars[name] : match));
}

interface UaDetection {
  browser: string;
  os: string;
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua)) return "opera";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/CriOS/.test(ua)) return "chrome";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "browser";
}

function detectOs(ua: string): string {
  if (/Windows/.test(ua)) return "windows";
  // Checked BEFORE the desktop "Mac OS X" pattern below: iOS UAs contain
  // the literal substring "like Mac OS X" (e.g. "CPU iPhone OS 17_0 like
  // Mac OS X") — iPhone/iPad/iPod must win that overlap.
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Mac OS X|Macintosh/.test(ua)) return "macos";
  if (/Android/.test(ua)) return "android";
  if (/Linux/.test(ua)) return "linux";
  return "unknown";
}

function detectUa(ua: string): UaDetection {
  return { browser: detectBrowser(ua), os: detectOs(ua) };
}

/** The `{device}` SETTING's own default (`useSettingsStore`'s
 * `gitDeviceName`) — parsed from the UA once at store-init time, then
 * user-editable forever after (roadmap §5.3: "auto-defaulted from UA ...,
 * user-editable"). Takes an explicit `ua` for testability
 * (`tests/unit/commitTemplate.test.ts` pins several real UA strings
 * without needing a browser); defaults to `navigator.userAgent` when
 * called from actual app code. e.g. `"chrome-linux"`, `"firefox-macos"`,
 * `"safari-ios"`. */
export function defaultDeviceName(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const { browser, os } = detectUa(ua);
  return `${browser}-${os}`;
}
