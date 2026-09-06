/**
 * The two placeholder components `packPlaceholderLogic.ts` registers for
 * every enabled pack's declared component (block/leaf-container form and
 * inline form). Split into its own file so it is the ONLY export here
 * (ESLint's `react-refresh/only-export-components` — the registry-building
 * logic, types, and `@markii/pack`/`@markii/react` wiring live in
 * `packPlaceholderLogic.ts` instead). See that file's module doc for the
 * full "why a pack's component is never executed" reasoning — these two
 * components are the entire visible surface of that decision.
 */
export function PackComponentPlaceholder({ packName, localName }: { packName: string; localName: string }) {
  return (
    <div className="mk-unknown mk-unknown--block">
      <p className="mk-unknown__label">
        {`Pack component not rendered: "${packName}/${localName}" is implemented in JavaScript (that pack's webview.js), which VSNote never executes for security. A pack component would otherwise run the instant this note is opened, with no sandbox and no grant prompt.`}
      </p>
    </div>
  );
}

export function PackComponentPlaceholderInline({ packName, localName }: { packName: string; localName: string }) {
  return (
    <span className="mk-unknown mk-unknown--inline">
      <span className="mk-unknown__label">{`${packName}/${localName}: not rendered (JS component)`}</span>
    </span>
  );
}
