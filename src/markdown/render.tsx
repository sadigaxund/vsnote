/**
 * The ONE static markdown renderer for the whole app (DESIGN-SPEC "Markii
 * extension" / docs/PLAN-2026-09-05-refresh.md §6 Phase M1). Every consumer
 * that needs to turn markdown TEXT into a static React tree — the public
 * share reader (§4.3) and print/export (`src/lib/printDocument.tsx`) —
 * calls `renderMarkdown` here rather than hand-rolling its own parser.
 * `.mk.md`'s Rendered mode is the exception as of Phase M2: it's the real
 * in-editor CM6 live preview (`editor/LivePreviewEditor.tsx` +
 * `markdown/directiveLezer/`), which renders each directive individually
 * via `@markii/react`'s `renderMark` directly (not this file — see
 * `directiveLezer/decorations.ts`'s doc for why a narrower, app-state-free
 * registry is used there). Plain
 * `.md` goes through this SAME pipeline with the directive registry
 * enabled anyway (`mergeRegistries(defaultRegistry, ...)`), which is the
 * whole point of the Markii extension: a `:kbd[x]` written in an ordinary
 * `.md` note renders too.
 *
 * ---- Why an AST rewrite instead of a render hook (link-map wiring) ----
 * `@markii/react`'s `renderMark`/`renderMarkNode` have exactly one option
 * (`resolveImageSrc`) and export none of their internals (`hastToReactTree`,
 * the `components` map passed to `hast-util-to-jsx-runtime`, `PreElement`)
 * — there is no `resolveHref`/link-rewrite hook to call into at render
 * time, and forking `render.tsx` or reaching into its DOM is out of scope
 * (CLAUDE.md rule 1's spirit: restyle/extend via the supported seam, never
 * fork). The supported path instead is upstream of rendering: parse the
 * text ourselves (`@markii/core`'s `parse`), walk and rewrite `link`
 * (and, as of this pass, `code`/`image`) nodes in the resulting mdast
 * `Root`, then render.
 *
 * VERIFIED: `renderMarkNode(node: MarkNode, ...)` takes exactly one
 * `RootContent` (`MarkNode` is `@markii/core`'s own re-export of mdast's
 * `RootContent` union) — a single top-level child, NOT a whole `Root`.
 * Neither `renderMark` (takes raw TEXT, parses it itself — cannot accept a
 * pre-parsed/mutated tree at all) nor `renderMarkNode` can render a mutated
 * `Root` directly. The supported composition, per this file's own mandate
 * to report exactly what was found rather than work around it: render each
 * of the mutated `Root`'s top-level children individually via
 * `renderMarkNode` and wrap the results in a `Fragment` — see
 * `renderMarkdown` below. This is exactly equivalent to a whole-document
 * render (`renderMark`) would produce, since `renderMark` itself is just
 * "parse, then render every top-level node the same way" one level up.
 *
 * ---- The `data`-stripping wrinkle (why unresolved links use a URL
 * sentinel, not a hast override) ----
 * `nodeToHast` (which `renderMarkNode` calls) deep-clones its input and
 * WHOLESALE-STRIPS every node's `data` field before running the mdast->hast
 * pipeline (`@markii/core`'s `to-hast.ts`: "the caller-controllable
 * hast-override channel" — a hardening measure against a transformed AST
 * dictating `data.hName`/`hProperties`, e.g. a `<script>` injection). That
 * means our rewritten link nodes CANNOT carry a `data.hProperties.class`/
 * `title` override the way a directive gets tagged — only mdast's own
 * top-level node fields (`url`, `title`) survive, since `remark-rehype`'s
 * default `link` handler reads those directly, not through `data`.
 *
 * So "muted, non-clickable text carrying `title=\"Not shared\"`" is built
 * from plain mdast vocabulary: the node STAYS a `link` (so its `title`
 * survives to a real DOM `title` attribute), but its `url` is set to a
 * deliberately-unsafe sentinel scheme (`mk-unresolved:`) that
 * `@markii/core`'s own `isSafeUrl`/`sanitizeUrls` (already wired into every
 * render path) strips at the hast stage — the resulting `<a>` element has a
 * `title` but no `href`, which HTML treats as an inert, non-focusable,
 * non-clickable placeholder anchor. `src/theme.css`'s markii block styles
 * `a:not([href])` inside `.mk-doc` as muted. No CSS class channel, no hast
 * override, and no library fork needed.
 *
 * ---- Fenced code blocks: the SAME AST-rewrite technique, one step
 * further ----
 * `renderMark`/`renderMarkNode`'s hast->React conversion hardcodes its
 * `components` map (`mk-directive`, `pre` for script-fence folding, `img`)
 * with no way for a caller to add or override an entry — a plain fenced
 * code block always becomes an unhighlighted `<pre><code>` (Markii
 * upstream finding #1, see below). Rather than accept that as a
 * regression, every mdast `code` node is rewritten — same walk, same
 * technique as the link rewrite — into a synthetic `leafDirective` node
 * named `vsnote-code` (`@markii/core`'s `tagDirectiveNodes` plugin tags
 * ANY node whose `type` is `'containerDirective'`/`'leafDirective'`/
 * `'textDirective'`, regardless of whether `remark-directive` or this
 * file produced it — see `to-hast.js`'s `isDirectiveNode`). That directive
 * name is registered, in the registry this file already merges over
 * `defaultRegistry`, to `vsnoteCodeDirective.tsx`'s `VSNoteCodeBlock`,
 * which renders `codeBlock.tsx`'s `<CodeBlock>` — the SAME highlighter
 * this app built for standalone code-file shares. The code body itself is
 * never serialized into the directive's `data-mk-attrs` JSON string (an
 * attribute-hostile or merely huge fence body has no business round-
 * tripping through directive-attribute grammar): each render builds a
 * small side table (`vsnoteCodeTable.ts`'s `CodeTableEntry[]`) and the
 * directive attribute carries only that entry's index; the table reaches
 * the component via `CodeTableContext`, not props, since a directive
 * component's only inputs are its attributes/children. See
 * `vsnoteCodeTable.ts`'s header for the full design.
 *
 * ---- Unresolvable relative images: text, never a broken-image icon ----
 * `resolveImageSrc` exists (`RenderMarkOptions`'s one field), but it only
 * ever gets a chance to run at RENDER time, deep inside `renderMark`'s own
 * `<img>` handling — by the time an unresolvable image would reach the
 * DOM, there is no seam left to swap it for something else. Since
 * `ResolveImageSrc` is a plain synchronous `(src) => string | undefined`
 * function (`@markii/react`'s `image-resolve.ts`), this file calls it
 * itself, during the SAME AST walk that rewrites links and code: a
 * relative image whose source the resolver cannot turn into a real URL
 * (or for which no resolver was given at all — print/export's case) is
 * replaced with the plain-text placeholder the old hand-rolled parser
 * produced (`Image: <alt, falling back to the written source>`) — a
 * broken-image icon in a printed or shared document is strictly worse
 * than the text it replaces.
 */
import { Fragment, type ReactElement } from "react";
import type { Code, Image, Link, Root, RootContent } from "mdast";
import { isSafeUrl, parse } from "@markii/core";
import { createRegistry, mergeRegistries, renderMarkNode, type Registry, type ResolveImageSrc } from "@markii/react";
import type { ValueStore } from "@markii/runtime";
import { defaultRegistry } from "@markii/react/components";
import { VSNoteCodeBlock } from "./vsnoteCodeDirective";
import { CodeTableContext, VSNOTE_CODE_DIRECTIVE_NAME, type CodeTableEntry } from "./vsnoteCodeTable";
import { buildPackRegistry, type PackForRegistry } from "./packPlaceholderLogic";

export interface RenderMarkdownOptions {
  /**
   * Vault-relative link target (exactly as written in the markdown, e.g.
   * `./part-2.md`) -> resolved share URL path (e.g. `/share/hello-world`).
   * Exactly the shape of `ShareContentOut.links` (`server/app/schemas.py`,
   * computed by `server/app/linkmap.py::compute_link_map`). Defaults to `{}`
   * (nothing resolves, every relative `.md` link degrades per
   * `degradeUnresolvedRelativeLinks`).
   */
  links?: Record<string, string>;
  /**
   * When true (the default), a RELATIVE link to a `.md` file that does not
   * resolve in `links` renders as muted, non-clickable text carrying
   * `title="Not shared"` instead of an ordinary (dead) link. Set to `false`
   * to leave such links exactly as written (e.g. printDocument.tsx: a
   * printed page has no `links` map at all, and an unresolved relative
   * link there is just a relative link, not a broken share).
   */
  degradeUnresolvedRelativeLinks?: boolean;
  /** Extra directive components merged OVER `@markii/react`'s `defaultRegistry` and this file's own `vsnote-code` entry (later wins). */
  registry?: Registry;
  /**
   * Resolves a relative `<img src>` to a URL a host can actually load.
   * Forwarded to `renderMarkNode` for a directive-built `<img>` (the
   * standard `Figure`), AND called directly during this file's own AST
   * walk so an unresolvable relative image can be replaced with a text
   * placeholder before rendering (see this file's header) rather than
   * reaching the DOM as a broken `<img>`.
   */
  resolveImageSrc?: ResolveImageSrc;
  /**
   * Packs enabled for this vault (Phase M3, worker 2), whose components
   * always render as a labelled, unrendered placeholder rather than any
   * real component — a pack's ONLY rendering artifact is compiled
   * third-party JavaScript (`webview.js`), which this app never executes;
   * see `packPlaceholder.tsx`'s module doc for the full reasoning. Merged
   * UNDER `options.registry`, so an explicit registry override still wins.
   * Omitted or empty (the default), behavior is unchanged from before this
   * option existed.
   */
  enabledPacks?: readonly PackForRegistry[];
  /**
   * A note's already-persisted script values (Phase M3, worker 1's
   * `loadPersistedValues` + `hydrateValueStore`), consumed by
   * `:value[name]` directives via `@markii/react`'s built-in
   * `renderMark`/`renderMarkNode` `store` parameter. Reading a value here
   * is exactly that — a read — never a script execution: this option
   * exists so a caller that already loaded a note's cached values (never
   * this file, which stays side-effect-free and async-free) can make them
   * visible in the static render. Omitted, `:value[]` degrades to its own
   * built-in "missing" marker, unchanged from before this option existed.
   */
  valueStore?: ValueStore;
}

const NOT_SHARED_TITLE = "Not shared";
const UNRESOLVED_URL_PREFIX = "mk-unresolved:";

/** A URL with no scheme (relative), matching the same "no scheme = relative" reading `@markii/core`'s own `isSafeUrl` uses — see that function's doc for why this is the correct way to find a scheme. */
function hasNoScheme(url: string): boolean {
  const colon = url.indexOf(":");
  if (colon === -1) return true;
  const slash = url.indexOf("/");
  const question = url.indexOf("?");
  const hash = url.indexOf("#");
  const schemeComesFirst = (slash === -1 || colon < slash) && (question === -1 || colon < question) && (hash === -1 || colon < hash);
  return !schemeComesFirst;
}

function isRelativeLink(url: string): boolean {
  return hasNoScheme(url) && !url.startsWith("//") && !url.startsWith("#");
}

function isMarkdownTarget(url: string): boolean {
  const withoutHash = url.split("#", 1)[0]!;
  const withoutQuery = withoutHash.split("?", 1)[0]!;
  return /\.md$/i.test(withoutQuery);
}

/** Flattens a node's inline children back to plain text, for a "degrade to plain text" case (an unsafe raw URL, or an unresolvable image). */
function flattenToText(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "inlineCode") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return (node.children as RootContent[]).map(flattenToText).join("");
  }
  return "";
}

function asPlainTextNode(node: RootContent): RootContent {
  return { type: "text", value: flattenToText(node) } as RootContent;
}

/** Rewrites one `link` node in place, or returns a replacement node (a plain-text degrade). See this file's header for the full design rationale. */
function rewriteLinkNode(node: Link, links: Record<string, string>, degradeUnresolved: boolean): RootContent {
  const written = node.url;
  const mapped = Object.hasOwn(links, written) ? links[written] : undefined;

  if (mapped !== undefined) {
    if (!isSafeUrl(mapped)) return asPlainTextNode(node);
    node.url = mapped;
    return node;
  }

  if (degradeUnresolved && isRelativeLink(written) && isMarkdownTarget(written)) {
    node.url = `${UNRESOLVED_URL_PREFIX}${written}`;
    node.title = NOT_SHARED_TITLE;
    return node;
  }

  if (!isSafeUrl(written)) return asPlainTextNode(node);
  return node;
}

/**
 * Rewrites one `image` node: a relative source that no resolver can turn
 * into a real URL becomes plain text (`Image: <alt or source>`), matching
 * the placeholder the hand-rolled parser this file replaced used to show
 * for a vault-relative image it could never load into a print window's
 * `blob:`-less document. An absolute/external source, or one a resolver
 * DOES resolve, is left untouched — `renderMark`'s own `<img>` handling
 * calls `resolveImageSrc` again at render time (a pure function, so
 * calling it twice is harmless) and applies the exact same
 * `isSafeResolvedImageSrc` guard `@markii/react` already has.
 */
function rewriteImageNode(node: Image, resolveImageSrc: ResolveImageSrc | undefined): RootContent {
  if (!isRelativeLink(node.url)) return node;
  const resolved = resolveImageSrc?.(node.url);
  if (resolved) return node;
  const label = node.alt || node.url;
  return { type: "text", value: `Image: ${label}` } as RootContent;
}

/** Rewrites one `code` (fenced or indented) mdast node into the synthetic `vsnote-code` leaf directive, pushing its body/language into `codeTable` and referencing it by index. See this file's header for the full rationale. */
function rewriteCodeNode(node: Code, codeTable: CodeTableEntry[]): RootContent {
  const idx = codeTable.length;
  codeTable.push({ code: node.value, lang: node.lang ?? undefined });
  return {
    type: "leafDirective",
    name: VSNOTE_CODE_DIRECTIVE_NAME,
    attributes: { idx: String(idx) },
    children: [],
  } as unknown as RootContent;
}

/** Walks `children` in place, rewriting every `link`/`image`/`code` node found anywhere in the subtree. A rewritten `code` node has no children of its own to recurse into (it becomes an empty-bodied leaf directive), so it `continue`s past the generic recursion step below it. */
function rewriteTree(children: RootContent[], options: RenderMarkdownOptions, codeTable: CodeTableEntry[]): void {
  const links = options.links ?? {};
  const degradeUnresolved = options.degradeUnresolvedRelativeLinks ?? true;

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.type === "link") {
      children[i] = rewriteLinkNode(child, links, degradeUnresolved);
    } else if (child.type === "image") {
      children[i] = rewriteImageNode(child, options.resolveImageSrc);
    } else if (child.type === "code") {
      children[i] = rewriteCodeNode(child, codeTable);
      continue;
    }

    const current = children[i]!;
    if ("children" in current && Array.isArray(current.children)) {
      rewriteTree(current.children as RootContent[], options, codeTable);
    }
  }
}

function parseAndRewriteTree(text: string, options: RenderMarkdownOptions): { root: Root; codeTable: CodeTableEntry[] } {
  const root = parse(text);
  const codeTable: CodeTableEntry[] = [];
  rewriteTree(root.children as RootContent[], options, codeTable);
  return { root, codeTable };
}

/**
 * Parses `text` and rewrites its links/images/code fences against
 * `options` before rendering. Exported (not just used internally by
 * `renderMarkdown`) so a caller that already has a parsed `Root` — none
 * does today, but the design explicitly separates "rewrite" from "render"
 * per this file's header — can reuse the rewrite step on its own. (Its own
 * code-fence side table is discarded here; use `renderMarkdown` when you
 * need highlighted fences rendered, which needs the table threaded to
 * `CodeTableContext` as well.)
 */
export function parseAndRewriteLinks(text: string, options: RenderMarkdownOptions = {}): Root {
  return parseAndRewriteTree(text, options).root;
}

const VSNOTE_DIRECTIVE_REGISTRY: Registry = createRegistry({
  [VSNOTE_CODE_DIRECTIVE_NAME]: { component: VSNoteCodeBlock, inline: false },
});

/**
 * Renders markdown `text` to a static React element. Directive-aware for
 * EVERY `.md`/`.mk.md` document (registry always includes
 * `@markii/react`'s `defaultRegistry` plus this file's own `vsnote-code`
 * entry, merged with `options.registry` when given — later wins). Never
 * throws (inherits `@markii/react`'s never-throw guarantee: a failure
 * renders markii's own `.mk-unknown` fallback box, per node).
 */
export function renderMarkdown(text: string, options: RenderMarkdownOptions = {}): ReactElement {
  const { root, codeTable } = parseAndRewriteTree(text, options);
  // `buildPackRegistry` can only report `{ ok: false, collisions }` for two
  // ENABLED packs sharing a namespace — `packStore.ts`'s `enable()` already
  // refuses to persist a colliding pack, so this should never happen in
  // practice; falling back to no pack registry (never throwing, never
  // dropping the rest of the render) is the safe degrade if it somehow did.
  const packInstall = options.enabledPacks?.length ? buildPackRegistry(options.enabledPacks) : undefined;
  const packRegistry = packInstall?.ok ? packInstall.registry : {};
  const registry = mergeRegistries(
    defaultRegistry,
    VSNOTE_DIRECTIVE_REGISTRY,
    packRegistry,
    options.registry ?? {},
  );
  const renderOptions = options.resolveImageSrc ? { resolveImageSrc: options.resolveImageSrc } : undefined;

  return (
    <CodeTableContext.Provider value={codeTable}>
      <div className="mk-doc">
        {root.children.map((node, index) => (
          <Fragment key={index}>{renderMarkNode(node, registry, options.valueStore, undefined, renderOptions)}</Fragment>
        ))}
      </div>
    </CodeTableContext.Provider>
  );
}
