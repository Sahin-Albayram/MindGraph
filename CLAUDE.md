# MindGraph — working notes

Local-only Electron desktop app for brainstorming with directed graphs and
nestable sub-graphs. Full reference: `docs/MINDGRAPH-project-spec.md`.
This file holds only fast-changing operational facts.

## Commands

```bash
npm run dev       # Vite + Electron, hot reload; this is how you run the app
npm run build     # typecheck, then bundle renderer + main + preload
npm run package   # build, then produce installers for the current platform
npm test          # vitest run
npm run test:watch
npm run typecheck # tsc --noEmit
```

## Environment

- Node is pinned by `.nvmrc` to **22**. On macOS it is managed by `fnm`; that
  machine also has a `node@16` Homebrew install for unrelated projects, so if
  `node -v` reports 16, run `fnm use` before anything else.
- On the Windows PC, use `fnm` or `nvm-windows` and the same `.nvmrc`. Node
  version parity across the two machines matters — mismatches show up as
  lockfile churn and native-binary errors, not as clear messages.

## Conventions

- **`src/types/graph.ts` is the single source of truth for the data model.**
  The runtime validator in `src/utils/fileFormat.ts` mirrors it by hand; change
  both together, and add a test for the new field.
- Never build a `Node`/`Edge`/`Graph` literal by hand — use `src/utils/factories.ts`,
  so defaults and id generation stay in one place.
- `deserialize()` never throws. It returns a `ParseResult` discriminated union;
  callers must branch on `.ok` and surface `.errors` to the user rather than
  silently discarding a damaged file (spec section 8: never lose work silently).
- TypeScript runs with `strict`, `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Omit optional fields rather than assigning
  `undefined` to them.
- Imports use explicit `.js` extensions, matching `moduleResolution: "bundler"`.
- `package.json` deliberately has **no `"type"` field**. vite-plugin-electron
  reads it to choose an output format, and CommonJS output is what lets the
  preload script run with `sandbox: true` — an ESM preload would force
  `sandbox: false`. This is also why the Vite configs are `.mts`.
- Emitted main/preload land in `dist-electron/`, the renderer bundle in `dist/`.
  Both are gitignored; `npm run dev` rebuilds them on change.

## Architecture rules

- The renderer never touches the filesystem. All reads/writes go through the
  preload `contextBridge` to the main process (`contextIsolation: true`,
  `nodeIntegration: false`).
- The store holds the **root graph plus a `GraphPath`** (a list of compound-node
  ids) identifying the sub-graph currently on screen — not a detached copy of it.
  Drill-down, undo/redo and save all operate on that one authoritative tree.
- Compound-node drill-down replaces the whole canvas with a different graph. It
  is *not* React Flow's "sub-flow" parent/child feature, despite what spec
  section 2 suggests — don't reach for that API.

## Cross-platform rules (Windows + macOS)

This is **one codebase**, not a macOS app with a Windows port. It is developed
on macOS and on a separate Windows PC, and must run unmodified on both. Every
change is subject to these:

- **No native modules.** Any dependency needing `node-gyp` compilation has to be
  rebuilt per platform and is the single biggest source of cross-platform pain.
  Prefer pure-JS packages. The chosen stack (React Flow, Zustand, electron-store)
  is all pure JS — keep it that way, and flag it if a candidate dependency isn't.
- **Never build paths by hand.** Always `path.join` / `path.resolve`; never
  concatenate with `/` or `\`, and never assume a separator when parsing.
- **One accelerator string for both.** Use `CmdOrCtrl+S`, never `Cmd+S`.
- **App lifecycle differs and both branches must exist:** on Windows, closing the
  last window quits the app; on macOS it does not, and `activate` must be able to
  recreate a window. Guard with `process.platform === "darwin"`.
- **The menu bar differs.** macOS needs an application menu whose first submenu
  is the app name; Windows uses a plain File/Edit/View bar. Build one template
  with a conditional macOS-only leading submenu — do not fork the menu code.
- **Use the native title bar** for the MVP. Custom window chrome means traffic
  lights on macOS versus min/max/close on Windows, and is the largest avoidable
  source of platform-specific UI code.
- **Font stacks, never a single font.** macOS has no Segoe UI and Windows has no
  SF Pro. Use a system stack so each platform picks its own.
- **Configure `mac` and `win` targets together** in electron-builder from the
  start, even while only one can be built here, so the Windows machine only ever
  runs `npm run build`.
- Line endings are normalised by `.gitattributes` (repo stores LF). Do not add
  editor- or OS-specific formatting config that fights it.

**Verify on Windows early.** The Windows PC should run `npm run dev` as soon as
the Step 1 scaffold lands, and after any change to the main process, packaging
config or filesystem code — not at the end. A toolchain problem found at Step 1
is a five-minute fix; found at Step 8 it blocks the release.

## Packaging

`npm run package:mac` emits both DMGs (arm64 + x64) into `release/`, which is
gitignored. Verified working: the packaged app loads from `app.asar` and the
preload bridge connects.

Two known gaps, both deliberate for now:

- **Unsigned.** `electron-builder.yml` sets `mac.identity: null`, so the build
  is only ad-hoc/linker-signed. It runs fine on the machine that built it, but
  a *downloaded* copy is quarantined and Gatekeeper refuses it
  ("code has no resources but signature indicates they must be present").
  Workaround for a trusted recipient: right-click -> Open, or
  `xattr -dr com.apple.quarantine /Applications/MindGraph.app`. The real fix is
  an Apple Developer ID plus notarization, which is a paid decision not yet made.
- **No app icon.** The default Electron icon is used. Add `build/icon.icns`
  (macOS, 512px+) and `build/icon.ico` (Windows) — `buildResources` already
  points at `build/`.

## Format versioning

`FORMAT_VERSION` lives in `src/types/graph.ts`. To ship a breaking schema
change: bump it, add a `MIGRATIONS[oldVersion]` entry in `fileFormat.ts`, and
add a test that opens a fixture written in the old version.

## Build order

Tracked in spec section 9.

- **Step 0** — data model, file format, validation, round-trip tests. *Done.*
- **Step 1** — Electron + Vite + React scaffold; window launches via `npm run dev`. *Done.*
- **Step 1.5** — packaging smoke test; both macOS DMGs build and the packaged app runs. *Done.*
- **Step 2** — Zustand store: root graph + `GraphPath`, and the undo/redo mechanism. *Next.*
- **Step 3** — React Flow canvas. First interactive build.
- **Step 4** — node detail panel. **Step 5** — edges.
- **Step 6** — save/open. First build whose work survives quitting.
- **Step 7** — compound-node drill-down. **Step 8** — polish, undo/redo UI, installers.
