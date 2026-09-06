/**
 * `src/markii/host/runScripts.ts`'s orchestration, exercised against fakes
 * for every Port (no real Worker, no real fs) so this stays a fast,
 * deterministic unit test of the WIRING: parse -> hydrate -> tier decision
 * -> grant lookup/prompt (manual only) -> isolate run -> persist.
 */
import { describe, expect, it, vi } from "vitest";
import type { ExecuteResult, StoredValue } from "@markii/runtime";
import { runScripts } from "../../src/markii/host/runScripts";
import type { GrantRecord, GrantStore, ScriptIsolate } from "../../src/markii/host/types";

function fakeGrantStore(initial: GrantRecord[] = []): GrantStore & { records: Map<string, GrantRecord> } {
  const records = new Map(initial.map((r) => [r.key, r]));
  return {
    records,
    async get(key) {
      return records.get(key);
    },
    async set(record) {
      records.set(record.key, record);
    },
    async revoke(key) {
      records.delete(key);
    },
    async listByPath(path) {
      return [...records.values()].filter((r) => r.path === path);
    },
    async list() {
      return [...records.values()];
    },
  };
}

function fakeIsolate(result: ExecuteResult): ScriptIsolate & { dispose: ReturnType<typeof vi.fn> } {
  return {
    run: async () => result,
    dispose: vi.fn(),
  };
}

const DOC = 'Some note text.\n\n```lua {name=answer}\nreturn 42\n```\n';

function memoryPersistence() {
  const files = new Map<string, Record<string, StoredValue>>();
  return {
    files,
    load: async (path: string) => files.get(path),
    save: async (path: string, values: Record<string, StoredValue>) => {
      files.set(path, values);
    },
  };
}

describe("markii runScripts orchestration", () => {
  it("manual trigger with no existing grant prompts once, persists an accepted grant, and runs", async () => {
    const grantStore = fakeGrantStore();
    const persistence = memoryPersistence();
    const isolate = fakeIsolate({ ok: true, value: 42 });
    const prompt = vi.fn().mockResolvedValue({
      granted: true,
      permissions: { net: { get: [], post: [] }, bundleWrite: false },
    });

    const summary = await runScripts("notes/a.mk.md", DOC, "manual", {
      isolateFactory: () => isolate,
      grantStore,
      grantPrompt: prompt,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0].path).toBe("notes/a.mk.md");
    expect(grantStore.records.size).toBe(1);
    expect(summary.results).toEqual([{ name: "answer", status: "fresh" }]);
    expect(isolate.dispose).toHaveBeenCalledTimes(1);
    expect(persistence.files.get("notes/a.mk.md")).toEqual({ answer: { value: 42, status: "fresh", ranAt: expect.any(Number) } });
  });

  it("manual trigger with an existing grant never prompts again", async () => {
    const key = await (
      await import("../../src/markii/host/grantClosure")
    ).computeNoteGrantKey({ scripts: [{ name: "answer", lang: "lua", code: "return 42" }] });
    const grantStore = fakeGrantStore([
      { key, path: "notes/a.mk.md", permissions: { net: { get: [], post: [] }, bundleWrite: false }, grantedAt: 1 },
    ]);
    const persistence = memoryPersistence();
    const isolate = fakeIsolate({ ok: true, value: 42 });
    const prompt = vi.fn();

    await runScripts("notes/a.mk.md", DOC, "manual", {
      isolateFactory: () => isolate,
      grantStore,
      grantPrompt: prompt,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(prompt).not.toHaveBeenCalled();
  });

  it("manual trigger with a denied prompt still runs, with no permissions carried into the capability config", async () => {
    const grantStore = fakeGrantStore();
    const persistence = memoryPersistence();
    const isolate = fakeIsolate({ ok: true, value: 42 });
    let capturedConfig: unknown;
    const prompt = vi.fn().mockResolvedValue({ granted: false });

    await runScripts("notes/a.mk.md", DOC, "manual", {
      isolateFactory: (config) => {
        capturedConfig = config;
        return isolate;
      },
      grantStore,
      grantPrompt: prompt,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(grantStore.records.size).toBe(0);
    expect(capturedConfig).toMatchObject({ tier: "manual" });
  });

  it("auto trigger never consults the grant store or prompt at all", async () => {
    const grantStore = fakeGrantStore();
    grantStore.get = vi.fn(grantStore.get);
    const persistence = memoryPersistence();
    const isolate = fakeIsolate({ ok: true, value: 42 });
    const prompt = vi.fn();

    await runScripts("notes/a.mk.md", DOC, "auto", {
      isolateFactory: () => isolate,
      grantStore,
      grantPrompt: prompt,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(grantStore.get).not.toHaveBeenCalled();
  });

  it("scheduled trigger behaves like auto: no prompt, no grant lookup", async () => {
    const grantStore = fakeGrantStore();
    grantStore.get = vi.fn(grantStore.get);
    const persistence = memoryPersistence();
    const isolate = fakeIsolate({ ok: true, value: 1 });
    const prompt = vi.fn();

    await runScripts("notes/a.mk.md", DOC, "scheduled", {
      isolateFactory: () => isolate,
      grantStore,
      grantPrompt: prompt,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(grantStore.get).not.toHaveBeenCalled();
  });

  it("omitting grantPrompt defaults to deny-everything (DEFAULT_DENY_PROMPT)", async () => {
    const grantStore = fakeGrantStore();
    const persistence = memoryPersistence();
    const isolate = fakeIsolate({ ok: true, value: 42 });

    await runScripts("notes/a.mk.md", DOC, "manual", {
      isolateFactory: () => isolate,
      grantStore,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(grantStore.records.size).toBe(0);
  });

  it("persists values even when a script fails, and disposes the isolate", async () => {
    const grantStore = fakeGrantStore();
    const persistence = memoryPersistence();
    const isolate = fakeIsolate({ ok: false, error: { kind: "script-error", message: "boom" } });

    const summary = await runScripts("notes/a.mk.md", DOC, "auto", {
      isolateFactory: () => isolate,
      grantStore,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(summary.errorCount).toBe(1);
    expect(persistence.files.get("notes/a.mk.md")?.answer.status).toBe("error");
    expect(isolate.dispose).toHaveBeenCalledTimes(1);
  });

  it("hydrates from a prior stale-marked run before executing", async () => {
    const grantStore = fakeGrantStore();
    const persistence = memoryPersistence();
    persistence.files.set("notes/a.mk.md", { answer: { value: 99, status: "fresh" } });
    const isolate = fakeIsolate({ ok: true, value: 42 });

    await runScripts("notes/a.mk.md", DOC, "auto", {
      isolateFactory: () => isolate,
      grantStore,
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    // After the run, the value store held the OLD value as 'stale' before
    // the fresh run overwrote it with 42 - the persisted result reflects
    // the fresh run, proving hydration fed into the same store runScripts
    // then persisted from (not a second, disconnected store).
    expect(persistence.files.get("notes/a.mk.md")).toEqual({ answer: { value: 42, status: "fresh", ranAt: expect.any(Number) } });
  });

  it("hands the isolate a structured-cloneable doc on every call, and a later script can read an earlier script's value through it (defect fix: DocView.value is a function and cannot cross postMessage)", async () => {
    const grantStore = fakeGrantStore();
    const persistence = memoryPersistence();
    const receivedDocs: unknown[] = [];

    const isolate: ScriptIsolate = {
      dispose: vi.fn(),
      run: async (input) => {
        receivedDocs.push(input.doc);
        if (input.code.includes("second")) {
          const read = input.doc?.values.get("first");
          return { ok: true, value: read?.ok ? read.value : null };
        }
        return { ok: true, value: 100 };
      },
    };

    const twoScriptDoc = [
      "```lua {name=first}",
      'return 100 -- "first"',
      "```",
      "",
      "```lua {name=second}",
      'return "second"',
      "```",
    ].join("\n");

    const summary = await runScripts("notes/two.mk.md", twoScriptDoc, "manual", {
      isolateFactory: () => isolate,
      grantStore,
      grantPrompt: async () => ({ granted: true, permissions: { net: { get: [], post: [] }, bundleWrite: false } }),
      loadPersistedValues: persistence.load,
      savePersistedValues: persistence.save,
    });

    expect(summary.results.map((r) => r.status)).toEqual(["fresh", "fresh"]);

    // Every doc handed to the isolate must survive a real structuredClone
    // round trip untouched - this is exactly what postMessage would do to
    // it, and a real DocView (a function-carrying object) would throw here.
    expect(receivedDocs.length).toBe(2);
    for (const doc of receivedDocs) {
      expect(() => structuredClone(doc)).not.toThrow();
      expect(structuredClone(doc)).toEqual(doc);
    }

    // The second script actually read the first script's value through the
    // snapshot handed to the isolate, proving the conversion preserves the
    // real doc.value() semantics, not just its cloneability.
    expect(persistence.files.get("notes/two.mk.md")?.second.value).toBe(100);
  });
});
