/**
 * Build-time flags injected by vite's `define` (see vite.config.ts).
 *
 * `__VSNOTE_DEMO_VAULT__` is DESIGN-SPEC Amendments round 5 item 36: the
 * full demo vault is opt-in, so a default build seeds a minimal welcome
 * vault instead. It is a `define` constant rather than an `import.meta.env`
 * lookup so the unused branch is dead code the bundler can drop, and so the
 * operator-facing env var keeps the project's `VSNOTE_*` naming instead of
 * vite's `VITE_*` prefix convention.
 *
 * Set `VSNOTE_DEMO_VAULT=1` at build time to opt in. CI's Pages job sets it
 * so the public demo keeps its showcase content, and `npm run test:e2e`
 * sets it so the e2e suite seeds the demo vault EXPLICITLY rather than
 * relying on it being the default.
 */
declare const __VSNOTE_DEMO_VAULT__: boolean;
