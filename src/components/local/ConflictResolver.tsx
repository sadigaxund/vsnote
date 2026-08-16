/**
 * ConflictResolver — Phase 11 (real sync, roadmap §5.2)'s in-app merge
 * conflict resolver, opened by `useGitStore`'s `conflict` state whenever
 * "Sync" (`sync.ts`'s `runSync`) hits a TRUE conflict (same lines changed
 * on both sides, or a modify/delete conflict) it can't auto-resolve.
 * **Nothing is pushed or discarded until the user resolves every file
 * here** — `runSync` returned `action: "conflict"` without writing
 * anything to the working tree/index/history; this component is the only
 * path back to a pushed merge commit.
 *
 * Built on the EXISTING `@codemirror/merge` stack (CLAUDE.md rule 7: one
 * editor stack, never a second) — the same package `editor/DiffView.tsx`
 * already uses for read-only diffs, here used for its OTHER documented
 * purpose: an editable buffer with a live diff against a reference
 * document (`unifiedMergeView`) plus its `acceptChunk`/`rejectChunk`
 * per-chunk commands and built-in accept/reject gutter controls
 * (`mergeControls: true`). No new editor engine, no Monaco.
 *
 * **Missing-component protocol** (CLAUDE.md rule 2): no library component
 * owns "a per-file, per-chunk three-way merge resolution UI" (checked
 * `skills/components.json` — `Dialog`/`Tabs`/`Textarea` exist, nothing
 * merge-conflict-shaped) — built locally, composing `Dialog`/`Button`/
 * `Badge`/`ScrollArea`/`Alert`/`Tooltip` for the chrome and a raw CM6
 * instance for the one part no library component could possibly cover.
 * Recorded in `docs/COMPONENT-BACKLOG.md`.
 *
 * Two conflict shapes, two different bodies:
 * - **"content"** (both sides edited overlapping lines): an editable CM6
 *   buffer seeded from "mine", diffed live against "theirs"
 *   (`unifiedMergeView`) with accept/reject gutter controls per hunk, plus
 *   whole-file "Take mine" / "Take theirs" / "Keep both" quick actions
 *   (roadmap §5.2's exact trio) that reset the buffer's starting point —
 *   still fully hand-editable afterward either way.
 * - **"delete"** (one side deleted the file, the other kept editing it): a
 *   simpler read-only preview of whichever side still has content, with
 *   "Keep the edited version" / "Delete the file" — no chunk-level UI
 *   makes sense when one side has no content to diff against.
 *
 * Every conflicted file gets a DEFAULT resolution the instant the dialog
 * opens (content conflicts default to "mine"; delete conflicts default to
 * keeping whichever side still has content, never a silent delete) — see
 * the mount effect below — so "Push merge & sync" is never blocked on the
 * user having visited every file, while still never silently discarding
 * either side's work: the default is always a real, chosen value, not an
 * empty/unset one.
 */
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ScrollArea, Tooltip } from "my-you-eye";
import { AlertTriangle, Check, Copy, FileWarning, GitMerge, Loader2, Trash2 } from "lucide-react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import { baseExtensions } from "../../editor/baseExtensions";
import { editorExtensions } from "../../editor/theme";
import { useGitStore } from "../../stores/useGitStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { repoToDisplayPath } from "../../fs/paths";
import type { ConflictFile } from "../../git/sync";

function defaultResolution(file: ConflictFile): string | null {
  if (file.kind === "delete") return file.ours ?? file.theirs ?? null;
  return file.ours ?? "";
}

function fileLabel(path: string): string {
  const display = repoToDisplayPath(path);
  return display.slice(display.indexOf("/") + 1) || display;
}

export function ConflictResolver() {
  const conflict = useGitStore((s) => s.conflict);
  const syncing = useGitStore((s) => s.syncing);
  const resolveConflict = useGitStore((s) => s.resolveConflict);
  const cancelConflict = useGitStore((s) => s.cancelConflict);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const fontSize = useSettingsStore((s) => s.editorFontSize);
  const lineSpacing = useSettingsStore((s) => s.editorLineSpacing);

  const [resolutions, setResolutions] = useState<Record<string, string | null>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  // Tracks which `conflict` object's defaults are currently seeded into
  // `resolutions`/`activePath` — compared during render (React's
  // documented "adjusting state when a prop changes" pattern) rather than
  // in a `useEffect`, so a fresh conflict's real, non-destructive default
  // for every file (see module doc) is ready on the SAME render it first
  // appears, never leaves a file unresolved-by-omission, and never
  // "cascading-renders" via an effect body calling `setState`.
  const [seededFor, setSeededFor] = useState<typeof conflict>(null);

  if (conflict !== seededFor) {
    setSeededFor(conflict);
    if (conflict) {
      const initial: Record<string, string | null> = {};
      for (const file of conflict.conflicts) initial[file.path] = defaultResolution(file);
      setResolutions(initial);
      setActivePath(conflict.conflicts[0]?.path ?? null);
    } else {
      setResolutions({});
      setActivePath(null);
    }
    setResetKey(0);
  }

  const activeFile = conflict?.conflicts.find((f) => f.path === activePath) ?? null;

  function applyQuickAction(path: string, content: string | null) {
    setResolutions((prev) => ({ ...prev, [path]: content }));
    setResetKey((k) => k + 1);
  }

  if (!conflict) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && !syncing && cancelConflict()}>
      <DialogContent size="lg" style={{ maxWidth: 920, width: "92vw", height: "80vh", display: "flex", flexDirection: "column" }} data-testid="conflict-resolver">
        <DialogHeader>
          <DialogTitle>
            <GitMerge size={16} style={{ marginRight: 6, verticalAlign: "-3px" }} />
            Resolve sync conflicts: {conflict.conflicts.length} file{conflict.conflicts.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            Local and remote both changed these files in ways Slate can't auto-merge. Nothing is pushed until you resolve every
            file and confirm below.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 12, marginTop: 8 }}>
          <ScrollArea style={{ width: 220, flexShrink: 0, border: "1px solid var(--color-border)", borderRadius: "var(--radius-ui-sm)" }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 4 }} data-testid="conflict-file-list">
              {conflict.conflicts.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    data-testid={`conflict-file-${fileLabel(file.path)}`}
                    onClick={() => setActivePath(file.path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      padding: "6px 8px",
                      border: "none",
                      borderRadius: "var(--radius-ui-sm)",
                      background: file.path === activePath ? "var(--color-surface-hover)" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--color-fg)",
                      font: "inherit",
                      fontSize: 12.5,
                    }}
                  >
                    {file.kind === "delete" ? <FileWarning size={13} style={{ flexShrink: 0 }} /> : <AlertTriangle size={13} style={{ flexShrink: 0 }} />}
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fileLabel(file.path)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {activeFile && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge variant="warning" tone="soft">
                    {activeFile.kind === "delete" ? "Deleted on one side" : "Content conflict"}
                  </Badge>
                  <span style={{ fontSize: 12, color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}>{activeFile.path}</span>
                  <div style={{ flex: 1 }} />
                  {activeFile.kind === "content" && (
                    <>
                      <Tooltip content="Keep the local version for this file">
                        <Button type="button" size="sm" variant="secondary" onClick={() => applyQuickAction(activeFile.path, activeFile.ours ?? "")}>
                          Take mine
                        </Button>
                      </Tooltip>
                      <Tooltip content="Keep the remote version for this file">
                        <Button type="button" size="sm" variant="secondary" onClick={() => applyQuickAction(activeFile.path, activeFile.theirs ?? "")}>
                          Take theirs
                        </Button>
                      </Tooltip>
                      <Tooltip content="Concatenate both versions in full">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            applyQuickAction(
                              activeFile.path,
                              `${activeFile.ours ?? ""}\n<<<<<<< keep-both: mine above, theirs below >>>>>>>\n${activeFile.theirs ?? ""}`,
                            )
                          }
                        >
                          <Copy size={13} />
                          Keep both
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </div>

                {activeFile.kind === "content" ? (
                  <ContentConflictEditor
                    key={`${activeFile.path}:${resetKey}`}
                    ours={resolutions[activeFile.path] ?? activeFile.ours ?? ""}
                    theirs={activeFile.theirs ?? ""}
                    wordWrap={wordWrap}
                    fontSize={fontSize}
                    lineSpacing={lineSpacing}
                    onChange={(text) => setResolutions((prev) => ({ ...prev, [activeFile.path]: text }))}
                  />
                ) : (
                  <DeleteConflictBody
                    file={activeFile}
                    resolved={resolutions[activeFile.path] ?? null}
                    onChoose={(content) => applyQuickAction(activeFile.path, content)}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter style={{ marginTop: 12 }}>
          <Button type="button" variant="ghost" disabled={!!syncing} onClick={() => cancelConflict()}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="conflict-resolve-push"
            disabled={!!syncing}
            onClick={() => void resolveConflict(resolutions)}
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {syncing ? "Merging…" : "Resolve & push"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ContentConflictEditorProps {
  ours: string;
  theirs: string;
  wordWrap: boolean;
  fontSize: number;
  lineSpacing: number;
  onChange: (text: string) => void;
}

/** The one CM6 instance that's actually editable + diffed live against
 * "theirs" (`unifiedMergeView`'s whole documented purpose — not the
 * read-only viewer `editor/DiffView.tsx` builds with the same package).
 * Remounted (via the caller's `key`) on every quick action so the buffer's
 * starting point genuinely resets rather than trying to programmatically
 * replace a live CM6 doc's entire content through a second code path. */
function ContentConflictEditor({ ours, theirs, wordWrap, fontSize, lineSpacing, onChange }: ContentConflictEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: ours,
        extensions: [
          ...baseExtensions({ wordWrap, tabSize: 2, fontSize, lineSpacing }),
          ...editorExtensions(),
          unifiedMergeView({ original: theirs, gutter: true, mergeControls: true }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current,
    });
    return () => view.destroy();
    // Intentionally mount-once per `key` (the parent remounts this whole
    // component on quick actions) — `wordWrap`/`fontSize`/`lineSpacing`
    // apply on next mount, same simplification `DiffView.tsx`'s
    // `MergeViewport` documents for its own read-only instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="conflict-merge-editor"
      style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius-ui-sm)" }}
    />
  );
}

interface DeleteConflictBodyProps {
  file: ConflictFile;
  resolved: string | null;
  onChoose: (content: string | null) => void;
}

function DeleteConflictBody({ file, resolved, onChoose }: DeleteConflictBodyProps) {
  const survivingContent = file.ours ?? file.theirs ?? "";
  const deletedByUs = file.ours === undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
      <Alert variant="warning" size="sm">
        {deletedByUs
          ? "You deleted this file; the remote kept editing it."
          : "The remote deleted this file; you kept editing it locally."}
      </Alert>
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" size="sm" variant={resolved !== null ? "primary" : "secondary"} onClick={() => onChoose(survivingContent)}>
          Keep the edited version
        </Button>
        <Button type="button" size="sm" variant={resolved === null ? "danger" : "secondary"} onClick={() => onChoose(null)}>
          <Trash2 size={13} />
          Delete the file
        </Button>
      </div>
      <ScrollArea style={{ flex: 1, minHeight: 0, border: "1px solid var(--color-border)", borderRadius: "var(--radius-ui-sm)", padding: 10 }}>
        <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{survivingContent}</pre>
      </ScrollArea>
    </div>
  );
}
