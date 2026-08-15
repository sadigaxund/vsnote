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
export const DEFAULT_BRANCH = "feat/incremental-index";

export const DEMO_AUTHOR = {
  name: "Slate Demo",
  email: "demo@slate.local",
};
