/**
 * `@markii/core`'s version, for the Extensions panel row and the Markii
 * extension page's About section (R5-9). A plain constant rather than a
 * JSON import of `node_modules/@markii/core/package.json` — this repo's
 * `tsconfig.json` doesn't set `resolveJsonModule`, and a reach into
 * `node_modules` from `src/` would also be the one import in this codebase
 * that isn't resolvable through a package's own public entry point. Keep
 * this in sync with the `@markii/core`/`@markii/runtime` version pin in
 * `package.json`'s `dependencies` by hand when that pin moves.
 */
export const MARKII_CORE_VERSION = "0.13.0";

/** markii-org/markii — the upstream project this extension is built on. */
export const MARKII_PROJECT_URL = "https://github.com/markii-org/markii";
export const MARKII_DOCS_URL = "https://github.com/markii-org/markii#readme";
export const MARKII_ISSUES_URL = "https://github.com/markii-org/markii/issues";
