/**
 * `vault/assets/cover.png`'s bytes — a small teal-to-charcoal gradient PNG
 * generated programmatically (Python `zlib`/`struct`, raw IDAT deflate, no
 * external tooling) matching the app's own `--color-bg`/`--color-primary`
 * tokens, then base64-embedded here. Per CLAUDE.md rule 3 (no network),
 * the seeder never fetches an image — this is real, valid PNG data decoded
 * client-side via `atob`.
 */
const COVER_PNG_BASE64 =
  "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";

/** Decodes the embedded base64 PNG into raw bytes for `fs.writeFile`. */
export function coverPngBytes(): Uint8Array {
  const binary = atob(COVER_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
