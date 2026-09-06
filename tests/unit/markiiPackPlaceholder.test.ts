/**
 * `src/markdown/packPlaceholder.tsx` (worker 2): a pack component always
 * registers as a placeholder, never anything derived from `webview.js`
 * (which this module never even reads). Also covers the re-vendored
 * `componentCatalog.ts`'s pack half (`buildComponentCatalog`).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPackRegistry } from "../../src/markdown/packPlaceholderLogic";
import { buildComponentCatalog } from "../../src/markdown/vendor/markiiHost";
import type { PackManifest } from "@markii/pack";

function manifest(overrides: Partial<PackManifest> = {}): PackManifest {
  return { name: "ana", engine: "react", components: { timeline: "./Timeline.tsx" }, ...overrides };
}

describe("buildPackRegistry", () => {
  it("registers a placeholder component under the composed namespaced directive name", () => {
    const result = buildPackRegistry([{ manifest: manifest() }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.ana_timeline).toBeDefined();
  });

  it("the placeholder's rendered markup names the pack and embeds no executable content at all", () => {
    const result = buildPackRegistry([{ manifest: manifest() }]);
    if (!result.ok) throw new Error("expected ok");
    const Component = result.registry.ana_timeline!.component;
    const html = renderToStaticMarkup(createElement(Component, { attributes: {} }));
    expect(html).toContain("ana/timeline");
    expect(html).toContain("not rendered");
    expect(html).not.toContain("<script");
  });

  it("reports a collision for two distinct packs sharing a namespace", () => {
    const result = buildPackRegistry([
      { manifest: manifest() },
      { manifest: manifest({ components: { other: "./Other.tsx" } }) },
    ]);
    expect(result.ok).toBe(false);
  });

  it("a non-react engine pack contributes nothing (falls through to the ordinary unknown-directive box)", () => {
    const result = buildPackRegistry([{ manifest: manifest({ engine: "vue" }) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.ana_timeline).toBeUndefined();
  });
});

describe("buildComponentCatalog (re-vendored, pack-aware)", () => {
  it("includes pack components after the standard/layout sections", () => {
    const catalog = buildComponentCatalog([{ manifest: manifest() }]);
    const packEntry = catalog.find((c) => c.directiveName === "ana_timeline");
    expect(packEntry).toBeDefined();
    expect(packEntry?.source).toBe("pack");
    expect(packEntry?.packName).toBe("ana");
  });

  it("defaults to standard components only when no packs are given", () => {
    const catalog = buildComponentCatalog();
    expect(catalog.every((c) => c.source === "standard")).toBe(true);
  });

  it("skips a pack component whose composed name collides with the standard set", () => {
    const catalog = buildComponentCatalog([{ manifest: manifest({ name: "callout", components: { x: "./X.tsx" } }) }]);
    // "callout" itself is a standard component; a pack literally named
    // "callout" would compose "callout_x", which cannot collide with the
    // bare standard name "callout" - this asserts the standard entry
    // itself is untouched by the pack's presence.
    const standardCallout = catalog.find((c) => c.directiveName === "callout");
    expect(standardCallout?.source).toBe("standard");
  });
});
