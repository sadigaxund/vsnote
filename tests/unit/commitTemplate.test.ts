/**
 * Pins `git/commitTemplate.ts`'s pure logic (Phase 11 — real sync, roadmap
 * §5.3): template substitution (known + unknown vars), the `{files}`
 * single-file-vs-N-files case, and `{device}`'s UA-derived default.
 */
import { describe, expect, it } from "vitest";
import {
  buildTemplateVars,
  defaultDeviceName,
  formatDatePart,
  formatFilesLabel,
  formatTimePart,
  formatTimestamp,
  renderCommitTemplate,
} from "../../src/git/commitTemplate";

describe("renderCommitTemplate()", () => {
  it("substitutes known variables", () => {
    expect(renderCommitTemplate("Synced from {device}: {timestamp}", { device: "chrome-linux", timestamp: "2026-08-15 12:00" })).toBe(
      "Synced from chrome-linux: 2026-08-15 12:00",
    );
  });

  it("substitutes the same variable used more than once", () => {
    expect(renderCommitTemplate("{branch} / {branch}", { branch: "main" })).toBe("main / main");
  });

  it("passes unknown {vars} through literally — never errors", () => {
    expect(renderCommitTemplate("Deploy to {environment} on {branch}", { branch: "main" })).toBe("Deploy to {environment} on main");
  });

  it("never throws on malformed braces (unmatched, empty, nested-looking)", () => {
    expect(() => renderCommitTemplate("unmatched { brace", {})).not.toThrow();
    expect(renderCommitTemplate("unmatched { brace", {})).toBe("unmatched { brace");
    expect(renderCommitTemplate("empty {} braces", {})).toBe("empty {} braces");
  });

  it("leaves a template with no variables untouched", () => {
    expect(renderCommitTemplate("Just a plain message", { device: "x" })).toBe("Just a plain message");
  });
});

describe("formatFilesLabel() — {files}", () => {
  it("shows the single filename (not the full path) when exactly one file changed", () => {
    expect(formatFilesLabel(["vault/notes/architecture.md"])).toBe("architecture.md");
  });

  it("shows a bare filename as-is when there's no path separator", () => {
    expect(formatFilesLabel(["README.md"])).toBe("README.md");
  });

  it("shows 'N files' for more than one changed file", () => {
    expect(formatFilesLabel(["a.md", "b.md", "c.md"])).toBe("3 files");
  });

  it("shows '0 files' rather than throwing on an empty list", () => {
    expect(formatFilesLabel([])).toBe("0 files");
  });
});

describe("formatDatePart() / formatTimePart() / formatTimestamp()", () => {
  it("formats YYYY-MM-DD, zero-padded", () => {
    expect(formatDatePart(new Date(2026, 0, 5, 9, 3))).toBe("2026-01-05");
  });

  it("formats HH:mm, zero-padded, 24h", () => {
    expect(formatTimePart(new Date(2026, 0, 5, 9, 3))).toBe("09:03");
  });

  it("formats the combined local timestamp", () => {
    expect(formatTimestamp(new Date(2026, 7, 15, 14, 30))).toBe("2026-08-15 14:30");
  });
});

describe("buildTemplateVars()", () => {
  it("assembles every documented variable", () => {
    const now = new Date(2026, 7, 15, 14, 30);
    const vars = buildTemplateVars({ device: "chrome-linux", branch: "main", files: ["notes/x.md"], now });
    expect(vars).toEqual({
      device: "chrome-linux",
      timestamp: "2026-08-15 14:30",
      date: "2026-08-15",
      time: "14:30",
      files: "x.md",
      branch: "main",
    });
  });
});

describe("defaultDeviceName() — UA-derived {device} setting default", () => {
  it("detects chrome on linux", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(defaultDeviceName(ua)).toBe("chrome-linux");
  });

  it("detects firefox on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(defaultDeviceName(ua)).toBe("firefox-macos");
  });

  it("detects safari on iOS", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(defaultDeviceName(ua)).toBe("safari-ios");
  });

  it("detects edge on windows (Edg/ must win over the Chrome/ substring Edge UAs also carry)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(defaultDeviceName(ua)).toBe("edge-windows");
  });

  it("falls back to a generic label for an unrecognized UA rather than throwing", () => {
    expect(defaultDeviceName("some-weird-client/1.0")).toBe("browser-unknown");
  });
});
