/**
 * R5-4 — client-side "save this blob as a file" trigger: a temporary
 * `<a download>` never appended anywhere visible, clicked once, then
 * removed and its object URL revoked. Shared by both places the file
 * header's Download button appears: the public share reader
 * (`share/ShareApp.tsx`, bytes from `share/api.ts::fetchShareRawBlob`, a
 * real round trip to `?download=1`) and the app's own (non-share) code
 * Rendered mode (`renderers/CodeView.tsx`, bytes built locally from the
 * already-open file's content — no server round trip for a file already in
 * the vault). Kept as one tiny DOM-touching helper rather than duplicated
 * in both callers.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
