/**
 * ShareApp — the `/share/<slug>[/<relpath>]` reader, rebuilt for round 6
 * item 10 to REUSE the main shell's own components instead of the old
 * divergent slim page: the local `TitleBar` shell, `ExplorerTree` (in its
 * `readOnly` mode), `EditorTabBar`, and `EditorHeader`'s breadcrumb + mode
 * cluster, all on the app's normal theme tokens (the old page forced a
 * white canvas under dark-theme selection colors — the root cause of the
 * reported "viewer mode selection" breakage, item 13: selecting text
 * painted dark-on-dark selection rectangles onto a white background,
 * i.e. invisibly). What is deliberately ABSENT: the activity bar, status
 * bar, command palette, settings, git, sharing controls — a visitor gets
 * reading (and, with the editor role, editing) chrome only.
 *
 * Hard requirements carried over from the previous implementation
 * (`docs/ROADMAP-SHARING-AUTH.md` §1/§5.1 — still binding):
 *
 * 1. **No VAULT access.** This route's chunk never imports `fs/`, `git/`,
 *    `stores/useFsStore`, `stores/useBufferStore`, `stores/useTabsStore`,
 *    or `stores/useGitStore` — nothing that opens the vault's IndexedDB.
 *    `ExplorerTree`'s pure helpers were extracted to `lib/fileTree.ts` for
 *    exactly this reason. (Round 6 relaxation, deliberate: reusing shell
 *    components means `useSettingsStore` — plain localStorage settings —
 *    may now load here; `main.tsx`'s `applyDomSettings` already themed
 *    this route from that same store before this change. Settings are the
 *    visitor's own browser state, not the vault.)
 * 2. **The no-existence-oracle contract** (`server/README.md`): every deny
 *    is the same generic state, keyed ONLY off `err.status === 404` —
 *    never off a response detail. Unreachable (non-404) gets its own
 *    distinct state.
 * 3. **Rendered-mode sandbox**: HTML renders only inside
 *    `renderers/HtmlPreview.tsx`'s `sandbox=""` iframe; markdown through
 *    the real live-preview pipeline (no raw-HTML widget exists there).
 *
 * Roles (items 11/12): the JSON payloads carry the caller's resolved
 * `role`. A viewer gets selectable text and a Rendered/Source toggle,
 * everything read-only. An editor edits through the SAME live-preview /
 * source editors the app uses; ⌘S or the Save button PUTs the content
 * back (`share/api.ts::putShareContent`), which the server re-gates and
 * lands both on the share's blob and, best-effort, as a commit in the
 * owner's bare sync repo (`server/app/vaultcommit.py`).
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Layout, Loader2, Lock } from "lucide-react";
import { Alert, Button, EmptyState, Input } from "my-you-eye";
import { TitleBar as TitleBarShell } from "../components/local/TitleBar";
import { ExplorerTree } from "../components/local/ExplorerTree";
import { EditorTabBar } from "../components/local/EditorTabBar";
import { SegmentedControl } from "../components/local/SegmentedControl";
import { Eye, FileCode } from "lucide-react";
import { HtmlPreview } from "../renderers/HtmlPreview";
import { LivePreviewEditor } from "../editor/LivePreviewEditor";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { fileTypeForOrPlain } from "../filetypes/registry";
import { inferFileKind } from "../lib/fileTree";
import {
  getShareFolderPathSameOrigin,
  postShareAuth,
  putShareContent,
  ShareApiError,
  type ShareContentOut,
  type ShareListingOut,
} from "./api";
import type { EditorMode, FileNode, TabItem } from "../types";

export interface ShareAppProps {
  /** The `<slug>` (or custom alias) segment of `/share/<slug>` — parsed by
   * `main.tsx`, never trusted beyond being passed to the (encoding) api
   * helpers. */
  identifier: string;
  /** The `<relpath...>` segment for folder-share deep links; `""` for a
   * plain `/share/<slug>` link. */
  initialRelpath?: string;
}

type LoadState = "loading" | "content" | "unavailable" | "unreachable";

function isListing(data: ShareListingOut | ShareContentOut): data is ShareListingOut {
  return "entries" in data;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Recursively expands `dir` entries into a full `FileNode[]` for
 * `ExplorerTree` — one listing fetch per directory, depth-first. Folder
 * shares are manifest-bounded, so this stays small; a fetch failure for a
 * subdirectory degrades to an empty folder rather than failing the page. */
async function buildShareTree(identifier: string, prefix: string): Promise<FileNode[]> {
  const data = await getShareFolderPathSameOrigin(identifier, prefix);
  if (!isListing(data)) return [];
  const nodes: FileNode[] = [];
  for (const entry of data.entries) {
    if (entry.kind === "dir") {
      const children = await buildShareTree(identifier, entry.relpath).catch(() => []);
      nodes.push({
        id: entry.relpath,
        name: entry.name,
        kind: "folder",
        path: entry.relpath,
        type: "folder",
        children,
        defaultExpanded: true,
      });
    } else {
      nodes.push({
        id: entry.relpath,
        name: entry.name,
        kind: inferFileKind(entry.name),
        path: entry.relpath,
        type: "file",
      });
    }
  }
  return nodes;
}

interface OpenShareTab extends TabItem {
  relpath: string;
}

export function ShareApp({ identifier, initialRelpath = "" }: ShareAppProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // null = single-file share (no tree pane at all); [] = folder share whose
  // tree is still loading or empty.
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [isFolderShare, setIsFolderShare] = useState(false);
  const [role, setRole] = useState<string>("viewer");
  const [shareLabel, setShareLabel] = useState("");

  const [tabs, setTabs] = useState<OpenShareTab[]>([]);
  const [activeRelpath, setActiveRelpath] = useState<string | null>(null);
  // relpath -> server content (immutably updated Map so render reads are
  // plain state); separate draft map for editor-role edits.
  const [contents, setContents] = useState<ReadonlyMap<string, ShareContentOut>>(() => new Map());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, EditorMode>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const openFileTab = useCallback((relpath: string, content: ShareContentOut) => {
    setContents((prev) => new Map(prev).set(relpath, content));
    const name = baseName(content.source_path);
    setTabs((prev) =>
      prev.some((t) => t.relpath === relpath)
        ? prev
        : [...prev, { id: relpath, path: relpath, name, kind: inferFileKind(name), relpath }],
    );
    setActiveRelpath(relpath);
  }, []);

  const load = useCallback(
    async (relpath: string) => {
      setState("loading");
      try {
        const data = await getShareFolderPathSameOrigin(identifier, relpath);
        if (data.role) setRole(data.role);
        if (isListing(data)) {
          setIsFolderShare(true);
          setShareLabel(data.alias ?? data.slug);
          setTree(await buildShareTree(identifier, "").catch(() => []));
        } else {
          setShareLabel((prev) => prev || baseName(data.source_path));
          if (relpath !== "") setIsFolderShare(true);
          if (relpath !== "" && tree === null) {
            // Deep link into a folder share — the tree pane still needs
            // the full listing.
            setTree(await buildShareTree(identifier, "").catch(() => []));
          }
          openFileTab(relpath, data);
        }
        setState("content");
        const suffix = relpath ? `/${relpath}` : "";
        window.history.replaceState(null, "", `/share/${encodeURIComponent(identifier)}${suffix}`);
      } catch (err) {
        // The ONLY branch allowed on error: 404 vs. didn't-complete. See
        // the module doc (no-existence-oracle contract).
        if (err instanceof ShareApiError && err.status === 404) {
          setState("unavailable");
        } else {
          setState("unreachable");
        }
      }
    },
    [identifier, openFileTab, tree],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the synchronous setState("loading") inside load() is intentional (immediate loading state), same reasoning as the pre-rebuild implementation.
    void load(initialRelpath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot-time fetch: `initialRelpath` is fixed and `load`'s only meaningful dependency is `identifier`.
  }, [identifier]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ok = await postShareAuth(identifier, password);
      if (ok) {
        setPassword("");
        await load(initialRelpath);
      } else {
        // Wrong password, dead share, nonexistent slug — indistinguishable
        // by design; the SAME generic state, never a "wrong password".
        setState("unavailable");
      }
    } catch {
      setState("unreachable");
    } finally {
      setSubmitting(false);
    }
  }

  const activeContent = activeRelpath !== null ? (contents.get(activeRelpath) ?? null) : null;
  const activeName = activeContent ? baseName(activeContent.source_path) : "";
  const activeKind = activeContent ? inferFileKind(activeName) : undefined;
  const canRender = activeKind === "md" || activeKind === "html";
  const activeMode: EditorMode =
    (activeRelpath !== null ? modes[activeRelpath] : undefined) ?? (canRender ? "rendered" : "source");
  const isEditor = role === "editor";
  const activeDraft = activeRelpath !== null ? drafts[activeRelpath] : undefined;
  const activeDirty = activeDraft !== undefined && activeDraft !== activeContent?.content;

  const handleSelectTreeNode = useCallback(
    (node: FileNode) => {
      if (node.type !== "file") return;
      const cached = contents.get(node.path);
      if (cached) {
        setActiveRelpath(node.path);
        window.history.replaceState(null, "", `/share/${encodeURIComponent(identifier)}/${node.path}`);
        return;
      }
      void getShareFolderPathSameOrigin(identifier, node.path)
        .then((data) => {
          if (!isListing(data)) {
            if (data.role) setRole(data.role);
            openFileTab(node.path, data);
            window.history.replaceState(null, "", `/share/${encodeURIComponent(identifier)}/${node.path}`);
          }
        })
        .catch(() => {
          // Row vanished server-side (revoked/republished mid-visit) —
          // leave the current view; a reload lands on the uniform state.
        });
    },
    [identifier, openFileTab, contents],
  );

  const handleSave = useCallback(async () => {
    if (!isEditor || activeRelpath === null || !activeDirty || activeDraft === undefined) return;
    setSaveState("saving");
    try {
      await putShareContent(identifier, isFolderShare ? activeRelpath : "", activeDraft);
      setContents((prev) => {
        const existing = prev.get(activeRelpath);
        return existing ? new Map(prev).set(activeRelpath, { ...existing, content: activeDraft }) : prev;
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[activeRelpath];
        return next;
      });
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }, [isEditor, activeRelpath, activeDirty, activeDraft, identifier, isFolderShare]);

  // ⌘S saves for the editor role (and never triggers the browser's own
  // save dialog for viewers either).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  if (state === "loading") {
    return (
      <ShareShell>
        <p style={{ color: "var(--color-muted)" }}>Loading…</p>
      </ShareShell>
    );
  }

  if (state === "unreachable") {
    return (
      <ShareShell>
        <Alert variant="warning" size="lg" title="Can't reach the server" icon={<AlertTriangle size={20} aria-hidden />} style={{ maxWidth: 420 }}>
          The sharing backend didn't respond. Try again in a moment.
        </Alert>
      </ShareShell>
    );
  }

  if (state === "unavailable" || (tabs.length === 0 && !isFolderShare)) {
    return (
      <ShareShell>
        {/* The password form is a SIBLING of the EmptyState (not its
            `action`) so this testid's textContent is exactly the title
            string — `share-password.spec.ts` requires it byte-identical
            across a wrong-password resubmit (server/README.md's "same
            404" contract). */}
        <EmptyState icon={<Lock size={28} aria-hidden />} title="This link is unavailable, or it requires a password." data-testid="share-unavailable-title" />
        <form onSubmit={(e) => void handlePasswordSubmit(e)} style={{ display: "flex", gap: 8 }} data-testid="share-password-form">
          <Input
            type="password"
            size="sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Share password"
            data-testid="share-password-input"
          />
          <Button type="submit" size="sm" loading={submitting} disabled={password.length === 0} data-testid="share-password-submit">
            Continue
          </Button>
        </form>
      </ShareShell>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: "var(--app-chrome-bg)", color: "var(--color-fg)" }}>
      <TitleBarShell
        glyph={
          <span
            aria-hidden
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, var(--color-primary), color-mix(in oklab, var(--color-primary) 55%, #7c6cf0))",
              color: "var(--color-primary-fg)",
            }}
          >
            <Layout size={12} strokeWidth={2.5} />
          </span>
        }
        title="VSNote"
        subtitle={shareLabel ? `/ ${shareLabel}` : undefined}
        actions={
          <span style={{ fontSize: 11.5, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }} data-testid="share-role-badge">
            {isEditor ? "Shared with you, can edit" : "Shared with you"}
          </span>
        }
      />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {isFolderShare && (
          <aside
            data-testid="share-folder-tree"
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: "1px solid var(--app-chrome-border)",
              overflow: "auto",
              background: "var(--app-chrome-bg)",
              paddingTop: 6,
            }}
          >
            {/* Phase 17 Milestone D: gives `ExplorerTree`'s own root a real
             * bounded height — needed only once it virtualizes (its
             * internal `VirtualList` needs a definite height to scroll
             * within, rather than nesting a second scrollable region
             * under this `<aside>`'s own `overflow: auto`). Below the
             * threshold `ExplorerTree`'s root is a plain `<ul>` with
             * natural content height that still overflows this wrapper
             * and gets scrolled by the `<aside>` exactly as before. */}
            <div style={{ height: "100%" }}>
              <ExplorerTree readOnly data={tree ?? []} selectedId={activeRelpath ?? undefined} onSelect={handleSelectTreeNode} />
            </div>
          </aside>
        )}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--app-editor-bg)" }} data-testid="share-folder-content">
          <EditorTabBar
            paneId="share"
            tabs={tabs}
            activeId={activeRelpath ?? undefined}
            onSelect={(id) => setActiveRelpath(id)}
            onClose={(id) => {
              // Computed OUTSIDE the updater — react-doctor
              // no-impure-state-updater: an updater must be a pure
              // (state) => state function; calling setActiveRelpath from
              // inside it both side-effects and reads stale render scope.
              const next = tabs.filter((t) => t.id !== id);
              setTabs(next);
              if (activeRelpath === id) setActiveRelpath(next.length > 0 ? next[next.length - 1].relpath : null);
            }}
          />
          {activeContent ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: "var(--app-chrome-paneheader-h)",
                  padding: "0 12px",
                  borderBottom: "1px solid var(--app-chrome-border)",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--color-muted)" }}>
                  {activeContent.source_path}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {isEditor && (
                    <>
                      {saveState === "failed" && (
                        <span style={{ fontSize: 12, color: "var(--git-deleted)" }} data-testid="share-save-error">
                          Save failed. Try again.
                        </span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant={activeDirty ? "primary" : "secondary"}
                        disabled={!activeDirty || saveState === "saving"}
                        onClick={() => void handleSave()}
                        data-testid="share-save"
                      >
                        {saveState === "saving" ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : activeDirty ? "Save" : saveState === "saved" ? "Saved" : "Save"}
                      </Button>
                    </>
                  )}
                  <SegmentedControl
                    size="xs"
                    value={activeMode}
                    onChange={(m: EditorMode) => activeRelpath !== null && setModes((prev) => ({ ...prev, [activeRelpath]: m }))}
                    options={[
                      { value: "rendered", label: "Rendered", icon: <Eye size={11} />, disabled: !canRender },
                      { value: "source", label: "Source", icon: <FileCode size={11} /> },
                    ]}
                  />
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
                <ShareFileView
                  key={activeRelpath}
                  content={activeContent}
                  draft={activeDraft}
                  mode={activeMode}
                  kind={activeKind}
                  editable={isEditor}
                  onChange={(value) => {
                    if (activeRelpath === null) return;
                    setSaveState("idle");
                    setDrafts((prev) => ({ ...prev, [activeRelpath]: value }));
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <EmptyState title="Select a file" description="Choose a file from the tree." />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** The content pane: the app's REAL editors/renderers, keyed by mode/kind.
 * Sandbox note (module doc point 3): HTML only ever renders inside
 * HtmlPreview's sandboxed iframe; markdown through live-preview (no
 * raw-HTML widget). Editing (item 12) reuses the same editors non-readOnly
 * with the draft's content. */
function ShareFileView({
  content,
  draft,
  mode,
  kind,
  editable,
  onChange,
}: {
  content: ShareContentOut;
  draft: string | undefined;
  mode: EditorMode;
  kind: ReturnType<typeof inferFileKind> | undefined;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  if (content.content_encoding === "base64") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState title="Binary file" description="This file has no text view." />
      </div>
    );
  }
  const text = draft ?? content.content;
  if (mode === "rendered" && kind === "html") {
    return <HtmlPreview content={text} />;
  }
  if (mode === "rendered" && kind === "md") {
    return <LivePreviewEditor paneId="share" path={content.source_path} content={text} readOnly={!editable} onChange={editable ? onChange : undefined} />;
  }
  return (
    <CodeMirrorEditor
      paneId="share"
      path={content.source_path}
      content={text}
      loadLanguage={fileTypeForOrPlain(kind).loadLanguage}
      readOnly={!editable}
      onChange={editable ? onChange : undefined}
    />
  );
}

function ShareShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        background: "var(--app-chrome-bg, #0e1015)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        padding: 24,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}
