Obsidian: Electron (and web tech everywhere)

Obsidian is an Electron app on desktop (Chromium + Node), and on mobile it's Capacitor — a webview wrapper, not native widgets. So Obsidian is web tech top to bottom; there is no native-UI version. That actually validates your plan: a note app built entirely in React/Vite can ship as a PWA, wrap to Electron for desktop, and Capacitor for mobile, with no native rewrite. "Lazy" is the industry standard here.

Two things to know about your pure-browser/PWA target specifically, because they differ from Electron/Node and touch markii's seams:

- Filesystem: a browser can't freely read the user's disk. Your bundle backend would use the File System Access API (Chromium) or OPFS, or just the zip form of .mkbundle via fflate (which @markii/bundle already ships browser-safe). The Node fs adapter (@markii/bundle/fs) is Node-only — that one's for the Electron path.
- Network + CORS: browser fetch is CORS-gated, so net.fetch_json can hit walls on APIs that don't send CORS headers (GitHub's API happens to be open; many aren't). Electron/Node has no CORS. This is the single biggest reason people eventually wrap in Electron.
- Terminatable worker: browsers have real Web Workers with terminate(), so you can satisfy the §10 kill-switch in a pure PWA — good news, you're not blocked on Electron for safe auto-runs.

Frontmatter uses: — you're right, there's no step in between

Your two-step model is exactly correct and complete: (1) install the pack → it extends the app's registry, (2) type :::ana-timeline in the note → it renders. uses: is not a step in that chain. I muddied it; let me place it precisely.

- Where it lives: inside each individual .mk.md file, at the very top, between --- fences. It's per-note, part of that one document — not app config, not a global.
- It is optional and loads nothing. With the pack installed, the component works whether or not uses: is present.
- What it's actually for: portability across setups. When a note travels to a different app or person who might not have ana installed, uses: [ana] lets the receiving app say "this note declares it needs pack ana, which you don't have" — and maybe offer to install it. Without it, an unknown component just silently renders the fallback box (still fine, never breaks); with it, the app can give a smarter message.
- Analogy: it's requirements.txt / package.json "dependencies," not an import statement. The code runs without it if the deps happen to be present; declaring them just lets tooling detect what's missing.

So in your own single app, you'd basically never write uses: — you control what's installed. It only earns its keep when notes are shared between different markii setups. Skip it until you care about that.

Prompt for your coding agent

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

A couple of notes for you (not the agent): the terminatable-worker isolate and the permission-grant UI are exactly the parts markii itself hasn't shipped yet — the playground runs scripts on the main thread, manual-only, precisely because it lacks these. So your agent is building genuinely new host infrastructure here, not re-treading the reference. If any of it turns out clean and reusable, it's a candidate to contribute back as an official adapter later.
