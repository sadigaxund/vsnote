/**
 * RunScriptsButton — the "Run scripts" action for `.mk.md` (Phase M3,
 * worker 3, deliverable 2). One component, mounted from TWO places so it
 * reads as one feature, not two: `EditorHeader.tsx` (the per-pane editor
 * header the plan asks for) and `local/OverflowMenu.tsx`'s
 * `OverflowMenuItems` (the tab bar `…` menu, matching repo convention for
 * document actions). It is deliberately NOT mounted in `components/
 * TitleBar.tsx` — a per-document action does not belong in the global
 * title bar next to app-level chrome, and an earlier draft that mounted it
 * there too showed two icon buttons for the same document at once, which
 * read as two different features rather than one. Both mount points read
 * the SAME `useMarkiiStore` run state, so a run kicked off from either
 * shows progress/outcome consistently.
 *
 * Renders nothing for anything other than `kind === "mkmd"` — this is a
 * `.mk.md`-only action, per the M3 plan.
 *
 * Progress: the button shows a spinner and disables itself for the
 * duration of `useMarkiiStore.runNote` (bounded by the isolate's own 10s
 * watchdog — see `runScripts.ts`'s doc — so this can never wedge the UI
 * indefinitely). Outcome: a toast naming which scripts ran, and — for any
 * failure — its real `FailureKind` and message, never a bare "failed"
 * (`runScriptsLogic.ts`'s `runMkMdScriptsWithToast`, shared with the
 * overflow-menu mirror entry).
 */
import { useMemo } from "react";
import { Button } from "my-you-eye";
import { useToast } from "./useToast";
import { Loader2, Play } from "lucide-react";
import { useMarkiiStore } from "../../stores/useMarkiiStore";
import { useBufferStore } from "../../stores/useBufferStore";
import { runMkMdScriptsWithToast } from "./runScriptsLogic";
import type { FileKind } from "../../types";

export interface RunScriptsButtonProps {
  path?: string;
  kind?: FileKind;
  /** `"labeled"` (default) shows text + icon, matching `EditorHeader`'s other actions; `"icon"` is icon-only for a tighter cluster. */
  variant?: "labeled" | "icon";
}

export function RunScriptsButton({ path, kind, variant = "labeled" }: RunScriptsButtonProps) {
  const { toast } = useToast();
  const running = useMarkiiStore((s) => (path ? (s.runningPaths[path] ?? false) : false));
  const content = useBufferStore((s) => (path ? s.buffers[path]?.content : undefined));

  const disabled = useMemo(() => running || path === undefined || content === undefined, [running, path, content]);

  if (kind !== "mkmd" || !path) return null;

  async function handleRun(): Promise<void> {
    if (!path || content === undefined) return;
    await runMkMdScriptsWithToast(path, content, toast);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={variant === "icon" ? "icon-sm" : "sm"}
      aria-label="Run scripts"
      disabled={disabled}
      onClick={() => void handleRun()}
      data-testid="run-scripts-button"
    >
      {running ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}
      {variant === "labeled" && <span style={{ marginLeft: 6 }}>Run scripts</span>}
    </Button>
  );
}
