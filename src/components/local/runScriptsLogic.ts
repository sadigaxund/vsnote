/**
 * Pure(ish) logic behind the "Run scripts" action, split out of
 * `RunScriptsButton.tsx` itself for the same `react-refresh/only-export-
 * components` reason `publishDialogLogic.ts`/`grantPromptLogic.ts` already
 * exist: `RunScriptsButton.tsx` exports a component; this module exports
 * everything else (a toast-reporting function), so `OverflowMenuItems`
 * (`local/OverflowMenu.tsx`) can share the exact same outcome-reporting
 * behavior as the button without importing from a component file.
 *
 * The actual failure-copy logic (`cleanErrorMessage`/`describeFailureEntry`)
 * lives in `scriptFailureCopy.ts`, a SEPARATE, `useMarkiiStore`-free module
 * — see that file's own doc for why (unit-test filesystem isolation) and
 * for the full writeup of the two bugs it fixes (denied network/bundle
 * access misclassified as a script bug; internal chunk identifiers/
 * tracebacks reaching a toast).
 */
import { useMarkiiStore } from "../../stores/useMarkiiStore";
import { cleanErrorMessage, describeFailureEntry } from "./scriptFailureCopy";
import type { RunSummary } from "@markii/runtime";

function summarizeFailures(summary: RunSummary): string {
  return summary.results
    .filter((r) => r.status === "error")
    .map(describeFailureEntry)
    .join("; ");
}

/** Runs `path`'s scripts (manual trigger) and reports the outcome through
 * `toast` (`my-you-eye`'s `useToast().toast`). Shared by `RunScriptsButton`
 * and `OverflowMenuItems`' mirror entry so the outcome copy is identical
 * regardless of which affordance started the run. */
export async function runMkMdScriptsWithToast(
  path: string,
  content: string,
  toast: (opts: { title: string; description?: string; variant?: "default" | "success" | "danger" }) => void,
): Promise<void> {
  try {
    const summary = await useMarkiiStore.getState().runNote(path, content, "manual");
    if (summary.results.length === 0) {
      toast({ title: "No scripts to run", description: "This note has no script blocks.", variant: "default" });
    } else if (summary.errorCount === 0) {
      toast({
        title: `Ran ${summary.freshCount} script${summary.freshCount === 1 ? "" : "s"}`,
        description: summary.results.map((r) => r.name).join(", "),
        variant: "success",
      });
    } else {
      toast({
        title: `${summary.errorCount} of ${summary.results.length} script${summary.results.length === 1 ? "" : "s"} failed`,
        description: summarizeFailures(summary),
        variant: "danger",
      });
    }
  } catch (err) {
    toast({ title: "Run failed", description: cleanErrorMessage(err instanceof Error ? err.message : String(err)), variant: "danger" });
  }
}
