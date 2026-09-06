/**
 * GrantPromptDialog — Phase M3, worker 3's real `GrantPrompt` UI
 * (`src/markii/host/types.ts`'s `GrantPrompt` seam), replacing
 * `DEFAULT_DENY_PROMPT`. Mounted once in `App.tsx`, exactly like
 * `PublishDialog`/`ConfirmDialog`: a controlled component driven by
 * `useMarkiiStore`'s `pendingGrantRequest` (set by `requestGrantDecision`,
 * called from `runScripts`'s `deps.grantPrompt`).
 *
 * Deny is the only safe default: closing the dialog any way OTHER than the
 * explicit "Allow" button (Escape, backdrop click, "Deny") resolves
 * `{ granted: false }` — `Dialog`'s `onOpenChange(false)` is the single
 * path every one of those funnels through, so there is exactly one place
 * that can ever say yes.
 *
 * Shows: the note's display path, every script by name (`GrantPromptRequest
 * .scripts`), the network hosts `grantPromptLogic.ts`'s best-effort scan
 * found (split into read/effectful, each independently toggleable — every
 * toggle defaults ON for a detected host, since ticking them off is exactly
 * how a user declines a specific host while still running the rest), and a
 * bundle-write toggle (defaulting OFF regardless of whether a script calls
 * `bundle.write` — writing to a note's own bundle is more sensitive than
 * reading network hosts the script already, visibly, tries to reach).
 *
 * The inner form (`GrantPromptForm`) is remounted per request via `key=
 * {request.grantKey}` rather than syncing its toggle state from `request`
 * in an `useEffect` — a fresh mount's `useState` initializers already read
 * the CURRENT request once, which is both simpler and avoids the
 * "setState synchronously in an effect" lint (`react-hooks/set-state-in-
 * effect`) an effect-based reset would trigger.
 */
import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
} from "my-you-eye";
import { Braces, Globe2, ShieldAlert } from "lucide-react";
import { permissionsFromSelection, scanScriptRequests } from "./grantPromptLogic";
import { useMarkiiStore } from "../../stores/useMarkiiStore";
import type { GrantDecision, GrantPromptRequest } from "../../markii/host/types";

function GrantPromptForm({ request, onDecide }: { request: GrantPromptRequest; onDecide: (decision: GrantDecision) => void }) {
  const scan = scanScriptRequests(request.scripts);
  const [getSelected, setGetSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(scan.getHosts.map((h) => [h, true])),
  );
  const [postSelected, setPostSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(scan.postHosts.map((h) => [h, true])),
  );
  const [bundleWrite, setBundleWrite] = useState(false);

  function allow(): void {
    const selectedGet = scan.getHosts.filter((h) => getSelected[h]);
    const selectedPost = scan.postHosts.filter((h) => postSelected[h]);
    onDecide({ granted: true, permissions: permissionsFromSelection(selectedGet, selectedPost, bundleWrite) });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldAlert size={16} aria-hidden />
          Let this note's scripts run?
        </DialogTitle>
        <DialogDescription>
          {request.path.split("/").pop()} wants to run {request.scripts.length === 1 ? "a script" : "its scripts"} with the permissions below. Nothing
          runs until you allow it.
        </DialogDescription>
      </DialogHeader>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 0" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)", marginBottom: 6 }}>
            Scripts
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {request.scripts.map((script) => (
              <div key={script.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
                <Braces size={12} aria-hidden />
                {script.name}
                <span style={{ color: "var(--color-muted)" }}>({script.lang})</span>
              </div>
            ))}
          </div>
        </div>

        {(scan.getHosts.length > 0 || scan.postHosts.length > 0) && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)", marginBottom: 6 }}>
              Network access
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scan.getHosts.map((host) => (
                <label key={`get-${host}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Globe2 size={12} aria-hidden />
                    {host} <span style={{ color: "var(--color-muted)" }}>(read)</span>
                  </span>
                  <Switch checked={!!getSelected[host]} onCheckedChange={(v) => setGetSelected((s) => ({ ...s, [host]: v }))} />
                </label>
              ))}
              {scan.postHosts.map((host) => (
                <label key={`post-${host}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Globe2 size={12} aria-hidden />
                    {host} <span style={{ color: "var(--color-muted)" }}>(sends data)</span>
                  </span>
                  <Switch checked={!!postSelected[host]} onCheckedChange={(v) => setPostSelected((s) => ({ ...s, [host]: v }))} />
                </label>
              ))}
            </div>
          </div>
        )}

        {scan.bundleWriteRequested && (
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
            <span>Allow writing to this note's bundle</span>
            <Switch checked={bundleWrite} onCheckedChange={setBundleWrite} data-testid="grant-bundle-write-toggle" />
          </label>
        )}

        <Alert variant="note" size="sm">
          This decision is remembered for this exact script content only. Editing any script in this note asks again next time.
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onDecide({ granted: false })} data-testid="grant-prompt-deny">
          Deny
        </Button>
        <Button type="button" variant="primary" onClick={allow} data-testid="grant-prompt-allow">
          Allow
        </Button>
      </DialogFooter>
    </>
  );
}

export function GrantPromptDialog() {
  const request = useMarkiiStore((s) => s.pendingGrantRequest);
  const resolve = useMarkiiStore((s) => s.resolveGrantPrompt);

  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) resolve({ granted: false });
      }}
    >
      <DialogContent data-testid="grant-prompt-dialog" style={{ maxWidth: 480 }}>
        {request && <GrantPromptForm key={request.grantKey} request={request} onDecide={resolve} />}
      </DialogContent>
    </Dialog>
  );
}
