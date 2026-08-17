Here's a self-contained brief. It builds the framework-agnostic host layer plus the browser adapter, structured so a future Electron or VS Code port only reimplements the I/O ports.

Build the "host layer" that integrates the markii libraries into our React/Vite
note app, structured so it can later be reused unchanged by an Electron or a
VS Code (webview) build. Do NOT reimplement parsing, rendering, or the sandbox —
consume the published packages: @markii/core (parse .mk.md → AST), @markii/react
(AST + registry → React tree), @markii/runtime (value store + trigger→tier gate),
@markii/lua (Lua sandbox + createLuaExecutor), @markii/bundle (.mkbundle fs +
path-jail). Read their READMEs first.

ARCHITECTURE — two folders:

  src/markii/host/      Platform-AGNOSTIC orchestration. May import the @markii/*
                        packages and React (React is the renderer for all web
                        hosts). MUST NOT import any platform/app-shell API
                        directly (no window.fs, no Electron, no VS Code, no
                        fetch/Worker used inline) — all such I/O goes through the
                        Ports defined below.

  src/markii/platform/browser/   The FIRST concrete adapter: implements the Ports
                        using browser APIs. A future platform/node/ or
                        platform/vscode/ folder will implement the same Ports.

PORTS (define as TS interfaces in host/, implement in platform/browser/):

  FileBackend    read(path)/write(path,bytes)/list(dir)/exists(path) over a
                 bundle root. Browser impl: File System Access API or OPFS for
                 the directory form, and fflate for the .mkbundle zip form.
                 ALL paths go through @markii/bundle's path-jail — never touch
                 raw paths yourself.
  NetProvider    fetch(url, opts) → used to build the `net` capability. Browser
                 impl: window.fetch. (Note CORS limits; that's expected.)
  ScriptIsolate  run(source, input, {timeoutMs}) → runs a Lua script in a
                 TERMINATABLE worker and resolves/rejects, killing on timeout.
                 Browser impl: a Web Worker that loads @markii/lua's
                 createLuaExecutor; the main thread enforces the wall-clock
                 watchdog and calls worker.terminate() on overrun. This is the
                 §10 kill-switch — do not run scripts on the main thread.
  GrantStore     get/set capability grants keyed by note-content-hash; a
                 prompt(request) callback for the permission UI. Browser impl:
                 IndexedDB + a React prompt component.

HOST ORCHESTRATION (in host/, written once, platform-agnostic):

  - Registry assembly: mergeRegistries(defaultRegistry, ...enabledPacks). Define
    a minimal pack shape { namespace, components } and a registerPack() API; we
    own this protocol. Prefixing is the author's job (:::ns-name).
  - openDocument(path): read via FileBackend → @markii/core parse → assemble
    registry → hydrate the @markii/runtime value store from the bundle's .cache/
    (if any) → return what the UI needs to render via @markii/react. RENDERING
    IS PURE: it only reads cached values, never executes a script.
  - runScripts(trigger): extract script blocks (@markii/core), run them through
    @markii/runtime's runDocumentScripts with the trigger→tier gate (manual =
    full grants; auto/scheduled = read-only tier — enforce this, do not bypass),
    execute each via the ScriptIsolate + @markii/lua executor, build the
    net/cache/bundle capability tables from the Ports + current GrantStore grants
    + the tier, marshal results into the value store, and persist outputs to
    .cache/ via FileBackend. Running is an explicit event, separate from render.
  - Capability construction: cache.get(key,ttl,fn) backed by .cache/; bundle.read
    jailed to the bundle; net gated by grants AND tier (read-only tier exposes no
    write/POST). Untrusted/no-grant notes must still render fully (empty/stale
    markers), never error.

UI (React, consumes host/ — keep app-shell code OUT of host/):
  - a Preview component that mounts the @markii/react tree
  - a Run action wired to runScripts('manual')
  - a settings panel: enabled packs, per-note/global grants, run-trigger prefs
    (auto-run on open? scheduled refresh?), fold/show/hide scripts

HARD CONSTRAINTS:
  - Scripts run ONLY in the terminatable ScriptIsolate; enforce the trigger→tier
    security gate; capabilities are injected into an empty Lua env (the packages
    already do this — don't weaken it).
  - No raw filesystem/network in host/ — everything behind Ports.
  - Rendering never runs scripts. Bound values degrade to empty/stale markers.
  - host/ imports nothing platform-specific, so platform/node/ and
    platform/vscode/ can later implement the same Ports with zero host/ changes.

Deliver: the Port interfaces, the host orchestration, the browser adapter, and a
minimal wired-up Preview + Run + settings so opening a .mk.md renders and Run
executes a script end-to-end. Follow our project's DESIGN.md §8 (scripting) and
§10 (security) if present.
