/**
 * Pure logic for the Packs settings category, split out of `Packs.tsx`
 * itself so that file only exports its `usePacksRows` hook — the same
 * `react-refresh/only-export-components` fix `publishDialogLogic.ts`
 * already established for `PublishDialog.tsx` (see that file's own doc
 * comment): a file mixing a hook export with component definitions breaks
 * Vite Fast Refresh's "a file only exports components" assumption.
 */
export interface PackLoadFailureLike {
  kind: string;
  message?: string;
  errors?: string[];
  entry?: string;
}

/** Turns a `PackEnableResult`'s `error` into a real, user-facing reason — never a generic "failed." */
export function describePackLoadFailure(error: PackLoadFailureLike): string {
  switch (error.kind) {
    case "zip":
      return error.message ?? "The file is not a valid pack archive.";
    case "manifest":
      return (error.errors ?? ["The pack manifest is invalid."]).join(" ");
    case "missing-entry":
      return `The pack is missing ${error.entry ?? "a required file"}.`;
    case "collision":
      return error.message ?? "A pack with this namespace is already installed.";
    default:
      return "The pack could not be loaded.";
  }
}
