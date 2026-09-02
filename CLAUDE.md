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

## Driving the app for verification

`npm run dev` launches Electron without a debugging port. To inspect the real
app over CDP, temporarily add one to the `onstart` args in `vite.config.mts`
(`startup([".", "--remote-debugging-port=9224"])`) and revert afterwards.

`main.ts` takes a single-instance lock, so a second Electron launched by hand
quits immediately and its debugging port never opens. If a probe cannot
connect, kill every instance first:
`pkill -9 -f "Repos/MindGraph/node_modules/electron"`.

## Development aids

- `window.__graphStore` exposes the store in the devtools console in dev builds
  (`__graphStore.getState()` shows the undo history). Stripped from production.
- The toolbar's "Load sample" button loads a populated document from
  `src/utils/sampleGraph.ts`. Also dev-only, behind `import.meta.env.DEV`.

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
- **Go through the store actions**, never mutate `root` directly. Actions apply
  an Immer recipe to the graph the path points at, then record history.
- **What is undoable is a deliberate policy**, enforced in `graphStore.ts`:
  node and edge edits yes; navigation and viewport changes no. `edit()` records
  history, `editSilently()` does not — pick the right one when adding an action.
- **Drags must coalesce.** Call `moveNode(id, pos, { coalesce: true })` during a
  drag and `endGesture()` on pointer-up, so one undo reverses one gesture rather
  than one animation frame. Forgetting `endGesture()` merges consecutive drags
  of the same node into a single undo entry.
- **Typing coalesces the same way.** `updateNodeData(id, patch, { coalesce:
  "title" })` and `updateEdge(id, patch, { coalesce: "label" })` group a burst
  of keystrokes into one undo entry; the detail panel closes the burst on blur
  and after a short idle pause. Passing `undefined` for a field removes it, so a
  cleared box leaves no empty string in the file — "solid" is likewise the
  *absence* of `style`, not a stored value.
- **The reader is liberal, the editor conservative.** `fileFormat.ts` accepts a
  self-referencing edge, because an existing file must still open; `connect()`
  refuses to create one. Keep that asymmetry in mind before "fixing" either
  side to match the other.
- Dirty state is `root !== savedRoot`, a reference comparison. It works because
  history holds the original objects, so undoing back to the saved state
  correctly reports clean. Do not replace it with a boolean flag.
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

## React Flow integration

Hard-won rules for `src/components/Canvas.tsx`. Breaking any of them produces
symptoms that look unrelated to the cause:

- **Never rebuild the node objects handed to React Flow from the store on every
  render.** React Flow annotates those objects with measurements; fresh objects
  discard them and it then refuses to drag "uninitialised" nodes. React Flow
  keeps its own copy via `applyNodeChanges`; an effect re-syncs that copy from
  the store, updating existing entries in place.
- **Selection is view state.** It lives only in React Flow's copy and must never
  reach the store or the file.
- **Deletion goes through `onDelete`, not `remove` changes.** React Flow reports
  a deleted node and its edges through two separate change callbacks; handling
  each would cost two undo presses for one Delete. `onDelete` fires once, and
  the store's `deleteElements` applies both in a single transaction.
- **`nodeTypes` must be module-scope.** A new object identity each render
  re-mounts every node.
- Edges render only after their endpoint nodes have been measured, so counting
  `.react-flow__edge` immediately after a state change under-reports. Trust the
  store, or wait for a paint.
- **`useOnSelectionChange` and `useReactFlow().fitView` do not work from
  components that are siblings of `<ReactFlow>`**, even inside
  `ReactFlowProvider`. `screenToFlowPosition` from the same instance does. So
  selection is reported upward from `Canvas`, which owns it, and "fit to view"
  is left to React Flow's own `<Controls>` rather than duplicated in the
  toolbar. Do not reintroduce a toolbar Fit button without verifying it moves
  the viewport — it fails silently.

## Files and IPC

- **Main moves bytes; the renderer decides what they mean.** `fileHandlers.ts`
  never parses document contents, so `fileFormat.ts` stays the single place
  that decides whether a document is well-formed. Do not add JSON parsing to
  the main process.
- **Saves are atomic**: written to a temp file beside the target, then renamed
  over it. An interrupted save leaves the previous version intact rather than a
  truncated one. Keep it that way.
- **Every path that discards a document is guarded** — New, Open, and closing
  the window all route through the same native prompt (`promptDiscard`), and a
  *failed* save is never treated as permission to discard.
- The renderer reports `{name, filePath, dirty}` to main on every change; main
  owns the window title, the macOS proxy icon and the edited dot.
- The close guard lives in main because main owns the window: on a dirty close
  it cancels the close, prompts, and (for "Save") asks the renderer to save and
  call `allowClose()`.

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
- **App icon is in place.** `build/` holds `icon.svg` (the master artwork),
  `icon.png` (1024px), `icon.icns` (macOS, all ten sizes) and `icon.ico`
  (Windows, seven sizes). Regenerate the `.icns` from the 1024px PNG with
  `sips` into an `.iconset`, then `iconutil -c icns`. Packaged builds take the
  icon from the bundle; `electron/main.ts` sets it explicitly in development
  only, where Electron would otherwise show its own default.

## Format versioning

`FORMAT_VERSION` lives in `src/types/graph.ts`. To ship a breaking schema
change: bump it, add a `MIGRATIONS[oldVersion]` entry in `fileFormat.ts`, and
add a test that opens a fixture written in the old version.

## Build order

Tracked in spec section 9.

- **Step 0** — data model, file format, validation, round-trip tests. *Done.*
- **Step 1** — Electron + Vite + React scaffold; window launches via `npm run dev`. *Done.*
- **Step 1.5** — packaging smoke test; both macOS DMGs build and the packaged app runs. *Done.*
- **Step 2** — Zustand store: root graph + `GraphPath`, undo/redo, navigation. *Done.*
- **Step 3** — React Flow canvas: add/drag/delete nodes, pan, zoom, undo/redo. *Done.*
- **Step 4** — node detail panel: title + markdown description. *Done.*
- **Step 5** — edges: draw by dragging between handles, label them, mark them
  tentative. *Done.*
- **Step 6** — save/open `.mindgraph` files, with unsaved-work guards. *Done.*
  Work now survives quitting.
- **Step 7** — compound-node drill-down. *Next.*
- **Step 8** — polish, minimap, installers.
