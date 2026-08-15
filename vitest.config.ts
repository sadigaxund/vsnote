import { defineConfig } from "vitest/config";

// Pure-logic unit suite (Phase 7, IMPLEMENTATION-PLAN.md): git status→letter
// mapping, diff-stat computation, pane-tree ops, filetype registry, draft
// checkpoint/restore, icon curated-table resolution. Deliberately
// `environment: "node"` (not jsdom/happy-dom) — nothing under test renders
// React; the two browser APIs the real store/fs modules assume
// (`window.localStorage`, `indexedDB`) are shimmed in `tests/unit/setup.ts`
// instead, which is enough for zustand `persist` + the real lightning-fs
// client to run unmodified.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/unit/setup.ts"],
    // One shared virtual filesystem instance per test FILE (module-level
    // singleton in fs/client.ts) — running test files in separate worker
    // processes (Vitest's default "threads"/"forks" pool already isolates
    // per file) keeps drafts.test.ts's real fs writes from ever colliding
    // with another file's.
    reporters: "default",
  },
});
