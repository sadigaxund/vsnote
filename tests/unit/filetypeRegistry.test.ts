/**
 * Pins `filetypes/registry.ts`'s mode-availability + default-mode table
 * (DESIGN-SPEC "Modes") — the single source `EditorHeader`'s segmented
 * control and `useTabsStore`'s "what mode does a newly-opened file start
 * in" both read.
 */
import { describe, expect, it } from "vitest";
import { defaultModeFor, fileTypeFor, fileTypeForOrPlain, languageIdFor, modeAvailabilityFor } from "../../src/filetypes/registry";
import { inferFileKind } from "../../src/lib/fileTree";

describe("filetypes/registry defaults", () => {
  it("md defaults to rendered", () => {
    expect(defaultModeFor("md")).toBe("rendered");
  });
  it("json defaults to source (the one table-explicit override besides code)", () => {
    expect(defaultModeFor("json")).toBe("source");
  });
  it("code kinds (ts/tsx/js/jsx/css) default to source", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css"] as const) {
      expect(defaultModeFor(kind)).toBe("source");
    }
  });
  it("html/csv default to rendered (ARCHITECTURE.md's documented interpretation of the table's silence)", () => {
    expect(defaultModeFor("html")).toBe("rendered");
    expect(defaultModeFor("csv")).toBe("rendered");
  });
  it("image defaults to (and only has) rendered", () => {
    expect(defaultModeFor("image")).toBe("rendered");
  });
  it("unrecognized kinds fall back to the plain-text entry's source default", () => {
    expect(defaultModeFor("unknown")).toBe("source");
    expect(defaultModeFor(undefined)).toBe("source");
  });
});

describe("filetypes/registry modeAvailabilityFor", () => {
  it("md offers rendered+source, plus diff only when the file has a real diff", () => {
    expect(modeAvailabilityFor("md", false)).toEqual(["rendered", "source"]);
    expect(modeAvailabilityFor("md", true)).toEqual(["rendered", "source", "diff"]);
  });

  it("code kinds (R3-7) offer rendered+source, plus diff when applicable", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css"] as const) {
      expect(modeAvailabilityFor(kind, false)).toEqual(["rendered", "source"]);
      expect(modeAvailabilityFor(kind, true)).toEqual(["rendered", "source", "diff"]);
    }
  });

  it("code kinds still default to source even though rendered is now offered", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css"] as const) {
      expect(defaultModeFor(kind)).toBe("source");
    }
  });

  it("code kinds use the 'code' renderer (CodeView, read-only CodeBlock)", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css"] as const) {
      expect(fileTypeFor(kind)?.renderer).toBe("code");
    }
  });

  it("images never offer diff, even when hasDiff is true (supportsDiff: false)", () => {
    expect(modeAvailabilityFor("image", true)).toEqual(["rendered"]);
  });

  it("folders and no-kind get no modes at all", () => {
    expect(modeAvailabilityFor("folder", true)).toEqual([]);
    expect(modeAvailabilityFor(undefined, true)).toEqual([]);
  });

  it("html/csv/json all offer rendered+source", () => {
    for (const kind of ["html", "csv", "json"] as const) {
      expect(modeAvailabilityFor(kind, false)).toEqual(["rendered", "source"]);
    }
  });

  it("the settings view tab (Phase 6.5c) gets no modes, even with a diff", () => {
    expect(modeAvailabilityFor("settings", true)).toEqual([]);
  });

  it("mkmd (Markii extension) offers rendered+source, plus diff, same as md", () => {
    expect(modeAvailabilityFor("mkmd", false)).toEqual(["rendered", "source"]);
    expect(modeAvailabilityFor("mkmd", true)).toEqual(["rendered", "source", "diff"]);
  });
});

describe("filetypes/registry mkmd entry (docs/PLAN-2026-09-05-refresh.md §6 Phase M2)", () => {
  it("defaults to rendered, using the same livepreview renderer as plain .md", () => {
    expect(defaultModeFor("mkmd")).toBe("rendered");
    expect(fileTypeFor("mkmd")?.renderer).toBe("livepreview");
  });
});

describe("R3-9: the generic 'code' fallback kind (@codemirror/language-data coverage)", () => {
  it("inferFileKind falls back to 'code' (not 'unknown') for extensions the hand-written table doesn't model", () => {
    for (const name of ["script.py", "main.go", "config.yaml", "deploy.sh", "lib.rs", "app.rb", "Query.sql"]) {
      expect(inferFileKind(name)).toBe("code");
    }
  });

  it("still classifies every hand-written kind exactly as before (the fallback never shadows an explicit case)", () => {
    expect(inferFileKind("a.ts")).toBe("ts");
    expect(inferFileKind("a.md")).toBe("md");
    expect(inferFileKind("a.json")).toBe("json");
    expect(inferFileKind("a.png")).toBe("image");
  });

  it("the 'code' entry offers rendered+source (default source), diff-capable, using the 'code' renderer — same shape as the hand-written code kinds", () => {
    expect(fileTypeFor("code")?.baseModes).toEqual(["rendered", "source"]);
    expect(defaultModeFor("code")).toBe("source");
    expect(fileTypeFor("code")?.renderer).toBe("code");
    expect(modeAvailabilityFor("code", false)).toEqual(["rendered", "source"]);
    expect(modeAvailabilityFor("code", true)).toEqual(["rendered", "source", "diff"]);
  });

  it("resolves a real CM6 language for .py/.go/.yaml/.sh via language-data, keyed by filename (not just kind)", async () => {
    for (const [filename, expectedId] of [
      ["main.py", "PYTHON"],
      ["main.go", "GO"],
      ["config.yaml", "YAML"],
      ["deploy.sh", "SHELL"],
    ] as const) {
      const entry = fileTypeForOrPlain("code");
      const extension = await entry.loadLanguage(filename);
      expect(extension, `${filename} should resolve a CM6 language extension`).not.toBeNull();
      const id = await languageIdFor("code", filename);
      expect(id).toBe(expectedId);
    }
  });

  it("degrades an extension language-data doesn't recognize either to plain text, not a crash", async () => {
    const entry = fileTypeForOrPlain("code");
    const extension = await entry.loadLanguage("mystery.vsnoteunknownext");
    expect(extension).toBeNull();
    expect(await languageIdFor("code", "mystery.vsnoteunknownext")).toBe("PLAIN");
  });

  it("loadLanguage with no filename (defensive) degrades to plain text rather than throwing", async () => {
    const entry = fileTypeForOrPlain("code");
    await expect(entry.loadLanguage(undefined)).resolves.toBeNull();
  });

  it("languageIdFor passes non-'code' kinds straight through to the synchronous languageId", async () => {
    expect(await languageIdFor("ts", "a.ts")).toBe("TS");
    expect(await languageIdFor(undefined, undefined)).toBe("PLAIN");
  });
});

describe("inferFileKind: .mk.md double extension wins over .md (src/lib/fileTree.ts)", () => {
  it("classifies a `.mk.md` file as mkmd, not md", () => {
    expect(inferFileKind("notes.mk.md")).toBe("mkmd");
    expect(inferFileKind("a/b/c.mk.md")).toBe("mkmd");
  });

  it("is case-insensitive on the double extension", () => {
    expect(inferFileKind("NOTES.MK.MD")).toBe("mkmd");
  });

  it("still classifies plain .md as md", () => {
    expect(inferFileKind("plain.md")).toBe("md");
  });

  it("does not misfire on a filename that merely contains 'mk' before .md", () => {
    expect(inferFileKind("bookmark.md")).toBe("md");
    // "mk.md" alone has no basename before the double extension (it would
    // need to be "<name>.mk.md"), so it is just an ordinary file named "mk".
    expect(inferFileKind("mk.md")).toBe("md");
    expect(inferFileKind("x.mk.md")).toBe("mkmd");
  });
});
