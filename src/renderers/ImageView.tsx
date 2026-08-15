/**
 * Image Rendered mode (the *only* mode for image kinds — DESIGN-SPEC Modes
 * table: "image viewer (only mode)"). Checkerboard backdrop (so
 * transparent PNGs read clearly against the near-black editor surface) +
 * zoom-to-fit (the library's `Image` `fit="contain"`, never upscaled past
 * its own natural size via `maxWidth`/`maxHeight: 100%`).
 *
 * Images are binary, so unlike the text renderers this reads bytes
 * directly off the fs by `path` rather than going through `useBufferStore`
 * (whose `content: string` model is for text buffers only) and builds an
 * object URL, revoked on unmount/path change.
 */
import { useEffect, useState } from "react";
import { EmptyState, Image, Spinner } from "my-you-eye";
import { ImageOff } from "lucide-react";
import { readBinaryFile } from "../fs/operations";
import { displayToFsPath } from "../fs/paths";

export interface ImageViewProps {
  path: string;
}

export function ImageView({ path }: ImageViewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // No reset-to-loading `setState` here: `EditorContent` keys this
    // component by `path` (`<ImageView key={path} .../>`), so a different
    // image remounts fresh with `url`/`failed` already at their initial
    // values — calling `setUrl(null)`/`setFailed(false)` synchronously at
    // the top of the effect would just be a same-value render no real
    // path change ever needs.
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await readBinaryFile(displayToFsPath(path));
        if (cancelled) return;
        // A plain copy into a fresh `ArrayBuffer` — lightning-fs's
        // `Uint8Array` is typed `Uint8Array<ArrayBufferLike>` (its backing
        // buffer could in principle be a `SharedArrayBuffer`), which
        // `BlobPart` rejects under this project's TS lib target; a real
        // `ArrayBuffer` copy satisfies the type and is cheap for
        // note-sized images.
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const blob = new Blob([buffer]);
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (failed) {
    return (
      <Centered>
        <EmptyState icon={<ImageOff size={28} />} title="Can't load image" description="This file couldn't be read from the vault." />
      </Centered>
    );
  }

  if (!url) {
    return (
      <Centered>
        <Spinner size="sm" />
      </Centered>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        backgroundColor: "var(--app-editor-bg)",
        backgroundImage:
          "linear-gradient(45deg, var(--color-surface-hover) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-hover) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-hover) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-hover) 75%)",
        backgroundSize: "20px 20px",
        backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
      }}
    >
      <Image src={url} alt={path} fit="contain" style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
      {children}
    </div>
  );
}
