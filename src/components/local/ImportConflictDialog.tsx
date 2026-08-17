/**
 * ImportConflictDialog — DESIGN-SPEC Amendments round 5 item 39: when an OS
 * drag-drop or Ctrl+V paste import (`App.tsx`'s `handleImportEntries`,
 * `fs/importEntries.ts`) collides with one or more existing vault paths,
 * this prompts a single choice for the whole batch: Rename (every
 * conflicting item gets the next non-colliding `name-1.ext` suffix, same
 * scheme `useFsStore.ts`'s `uniqueName` already uses elsewhere) or Replace
 * (overwrite in place), or Cancel to import nothing.
 *
 * Missing-component check (CLAUDE.md rule 2): `skills/components.json`'s
 * `ConfirmDialog` (used by this same file's sibling `Sidebar.tsx` delete
 * prompt) is a single confirm/cancel action only — no third "Rename"
 * button. That's not a missing PRIMITIVE though, just one more action than
 * `ConfirmDialog`'s fixed shape offers, so this composes the library's own
 * `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/
 * `DialogFooter`/`Button` directly — the same "solved by composition, not a
 * new local primitive" precedent `docs/COMPONENT-BACKLOG.md`'s Notes
 * section already records for `PublishDialog`/`SharedPanel`.
 */
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "my-you-eye";

export interface ImportConflictDialogProps {
  open: boolean;
  conflictNames: string[];
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onReplace: () => void;
}

export function ImportConflictDialog({ open, conflictNames, onOpenChange, onRename, onReplace }: ImportConflictDialogProps) {
  const count = conflictNames.length;
  const summary =
    count === 1 ? `"${conflictNames[0]}" already exists here.` : `${count} items already exist here.`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="import-conflict-dialog">
        <DialogHeader>
          <DialogTitle>Import conflict</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="secondary" onClick={onRename}>
            Rename
          </Button>
          <Button type="button" variant="primary" onClick={onReplace}>
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
