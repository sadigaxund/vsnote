/**
 * DiffStatChip — tiny `+12 -5` added/removed chip.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("DiffStatChip", status
 * `built-locally`, used in `src/components/EditorHeader.tsx` and
 * `src/components/StatusBar.tsx`). `Badge` is a single-tone label and
 * can't express two independently colored numbers in one compact unit
 * without nesting two Badges (which reintroduces Badge's own padding/pill
 * chrome twice); this is a plain inline composition of the token colors,
 * not a restyled Badge.
 */
export interface DiffStatChipProps {
  added: number;
  removed: number;
  size?: "sm" | "md";
}

export function DiffStatChip({ added, removed, size = "sm" }: DiffStatChipProps) {
  const fontSize = size === "sm" ? 12 : 13;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize,
        fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
    }} >
      <span style={{ color: "var(--git-added)" }}>+{added}</span>
      <span style={{ color: "var(--git-deleted)" }}>-{removed}</span>
    </span>
  );
}
