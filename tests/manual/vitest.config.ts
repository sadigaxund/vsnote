import { defineConfig } from "vitest/config";

// Separate vitest project, deliberately NOT picked up by the main
// `vitest.config.ts` (`include: ["tests/unit/**/*.test.ts"]` — this
// directory is outside that glob) or by `npm run test:unit`. This is the
// runner for `server/scripts/sync-merge-demo.sh`'s narrated proof
// (`syncMergeDemo.spec.ts`) — it needs a REAL JS runtime driving the app's
// OWN `src/git/*` modules (not a bash/curl reimplementation of the merge
// logic) against a REAL running backend, which is exactly what this
// project's unit suite already knows how to do for offline logic
// (`fake-indexeddb/auto` + the real lightning-fs client, same setup file)
// — this config just points that same machinery at a different, explicitly
// invoked file instead of the automatic unit-test glob.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/manual/*.spec.ts"],
    setupFiles: ["./tests/unit/setup.ts"],
    reporters: "verbose",
    // The demo drives a real HTTP round trip against a real uvicorn
    // process per step — generous enough to never be the reason a real
    // backend interaction looks like a hang.
    testTimeout: 30_000,
  },
});
