/**
 * Logo — the VSNote mark, inline SVG (never an `<img>`, so it scales
 * crisply at any `size` and, in `mono` mode, inherits `currentColor` from
 * its surrounding text/icon color).
 *
 * Path data is transcribed VERBATIM from the two master artwork files (do
 * not redraw here — edit the masters instead and re-transcribe):
 *   - `public/favicon.svg` (default: full-color, teal ribbon arms + pale
 *     folded-corner page on a dark chip).
 *   - `public/logo-mono.svg` (`mono`: single-color strokes on
 *     `currentColor`, for contexts where the surrounding chrome already
 *     supplies the background, e.g. a small title-bar glyph).
 * Both master files are 512x512 viewBox; this component keeps that
 * viewBox so the transcribed `<path>`s need no coordinate changes.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("Logo", status `built-locally`),
 * replacing the duplicated CSS-gradient "logo chip" `<span>` that used to
 * be hand-rolled in `components/TitleBar.tsx`, `share/ShareApp.tsx`, and
 * `components/LoginGate.tsx` — none of those actually drew the VSNote
 * mark, just a generic gradient square with a `lucide-react` `Layout`
 * icon standing in for it.
 */
export interface LogoProps {
  /** Rendered width/height in px (square). Default 16. */
  size?: number;
  /** Renders `public/logo-mono.svg`'s single-color geometry
   * (`stroke="currentColor"`) instead of the full-color mark — for
   * contexts that already supply their own background chip. */
  mono?: boolean;
  /** Accessible name. Omit for a purely decorative mark (the default:
   * `aria-hidden`); pass a string when the logo is the only content
   * conveying "this is VSNote" (e.g. no adjacent wordmark text). */
  title?: string;
  className?: string;
}

export function Logo({ size = 16, mono = false, title, className }: LogoProps) {
  const labelProps = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true };

  if (mono) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...labelProps}
      >
        <path d="M232 132 L96 256 L232 380" strokeWidth={76} />
        <path
          d="M256 56 H364 L444 136 V428 A28 28 0 0 1 416 456 H256 A28 28 0 0 1 228 428 V84 A28 28 0 0 1 256 56 Z"
          strokeWidth={36}
          fill="#0e1015"
        />
        <path d="M364 60 V108 A28 28 0 0 0 392 136 H440" strokeWidth={36} />
        <g strokeWidth={26}>
          <path d="M292 240 H380" />
          <path d="M292 300 H380" />
          <path d="M292 360 H340" />
        </g>
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} {...labelProps}>
      <path
        d="M232 132 L96 256 L232 380"
        fill="none"
        stroke="#27d2c5"
        strokeWidth={76}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M256 56 H364 L444 136 V428 A28 28 0 0 1 416 456 H256 A28 28 0 0 1 228 428 V84 A28 28 0 0 1 256 56 Z"
        fill="#e8f6f4"
      />
      <path d="M364 56 V108 A28 28 0 0 0 392 136 H444 Z" fill="#17a99e" />
      <g stroke="#27d2c5" strokeWidth={26} strokeLinecap="round">
        <path d="M280 236 H392" />
        <path d="M280 296 H392" />
        <path d="M280 356 H344" />
      </g>
    </svg>
  );
}
