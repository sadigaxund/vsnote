/**
 * isomorphic-git configuration shared by every `git/` module: the fs
 * backend (the same lightning-fs singleton `fs/client.ts` uses, so the
 * working tree isomorphic-git sees is exactly what the file explorer
 * reads/writes), the repo root, branch name, and the demo commit identity.
 */
import { fs } from "../fs/client";
import { VAULT_DIR } from "../fs/paths";

export { fs };
export const GIT_DIR = VAULT_DIR;
// Round 7 item 53 — `main`, the boring correct default. The scaffold-era
// `feat/incremental-index` (a demo-fiction name) leaked into every fresh
// vault and even prefilled the server-vault wizard; existing vaults keep
// whatever branch they already sit on (this constant only seeds NEW inits
// and serves as a last-resort fallback when no branch is resolvable).
export const DEFAULT_BRANCH = "main";

export const DEMO_AUTHOR = {
  name: "VSNote Demo",
  email: "demo@vsnote.local",
};
