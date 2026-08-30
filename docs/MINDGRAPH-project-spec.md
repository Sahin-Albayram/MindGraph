# MindGraph — Project Specification

*A local, cross-platform desktop app for visual brainstorming with directed graphs and nestable sub-graphs.*

---

## 1. Vision

MindGraph is a desktop app for capturing brainstorming as a **directed graph**: nodes hold ideas with detail, edges show relationships, and any node can itself contain a full nested sub-graph — so a single idea can be "zoomed into" to explore its own web of sub-ideas without cluttering the top-level view.

It runs entirely **locally** on Windows and macOS, with **no account, no server, and no network dependency**. Diagrams are saved to a file on disk and reopened later, like any native document-based app (think: a text editor, but for graphs).

---

## 2. Platform & tech stack

| Layer | Choice | Why |
|---|---|---|
| App shell | **Electron** | Mature, well-documented, single codebase ships native installers for both Windows (`.exe`/NSIS) and macOS (`.dmg`), Intel + Apple Silicon. |
| Frontend | **React + TypeScript**, bundled with **Vite** | Fast dev loop, strong typing for the graph data model. |
| Graph canvas | **React Flow** (`@xyflow/react`) | Purpose-built for node/edge editors: drag, zoom/pan, custom node types, handles for connecting edges, minimap and controls out of the box. Its "sub-flow" pattern is a good starting point for compound nodes. |
| State management | **Zustand** | Lightweight, plays well with React Flow's own examples, avoids Redux boilerplate. |
| Styling | **Tailwind CSS** (or plain CSS modules if you prefer) | Fast iteration on a fairly custom UI. |
| Local persistence | Electron `fs` + native `dialog` module (Save/Open) in the **main process**, exposed to the renderer via a `contextBridge` **preload script** | Keeps filesystem access out of the renderer for security (`contextIsolation: true`, `nodeIntegration: false`). |
| Settings / recents | **electron-store** | Simple key-value store for "recent files", window bounds, preferences. |
| Packaging | **electron-builder** | One config, builds both platform installers. |
| Testing | **Vitest** + React Testing Library for units; **Playwright** for Electron end-to-end (add once the core flow works) | |

This stack keeps everything in JavaScript/TypeScript — no separate backend language to context-switch into, which matters when most of the build is going to be AI-assisted.

---

## 3. Data model

```ts
interface GraphFile {
  formatVersion: number;      // bump on breaking schema changes
  app: "MindGraph";
  graph: Graph;
}

interface Graph {
  id: string;
  name: string;
  createdAt: string;          // ISO timestamp
  updatedAt: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: Node[];
  edges: Edge[];
}

interface Node {
  id: string;
  type: "idea" | "compound";  // "compound" nodes contain a nested Graph
  position: { x: number; y: number };
  data: {
    title: string;
    description?: string;     // markdown
    color?: string;           // tag color, not required
    tags?: string[];
    subgraph?: Graph;         // present only when type === "compound"
  };
}

interface Edge {
  id: string;
  source: string;             // Node.id
  target: string;             // Node.id
  label?: string;
  style?: "solid" | "dashed"; // dashed = tentative/weak connection
}
```

### File format
A `.mindgraph` file is this `GraphFile` object serialized as pretty-printed JSON. Keeping it human-readable (not a binary/compressed blob) means a corrupted file can still be hand-inspected or repaired, and it's trivially diffable in git if someone wants to version their brainstorms.

**Open design question:** should a compound node's sub-graph live *inline* in the same file (simplest, one file per diagram) or as a *linked separate file* (better for very large graphs, but adds file-management complexity)? **Recommendation: start inline.** It's simpler to implement and reason about; only split into linked files later if performance actually demands it.

---

## 4. Core features

### Phase 1 — MVP
- [ ] Create, rename, and delete nodes on an infinite canvas
- [ ] Click a node to open a detail panel: edit title + markdown description
- [ ] Drag nodes freely; drag from a node's edge/handle to draw a directed connection to another node
- [ ] Pan and zoom the canvas (scroll/pinch + zoom controls + "fit to view")
- [ ] Mark a node as **compound**; double-click it to enter its nested sub-graph on a fresh canvas, with a breadcrumb trail back to parent graphs
- [ ] Save to a local `.mindgraph` file and open an existing one via native OS dialogs
- [ ] Track unsaved changes; warn before closing/opening over unsaved work
- [ ] Undo/redo for node and edge edits

### Phase 2 — Quality of life
- [ ] Full-text search across all nodes, including inside nested sub-graphs
- [ ] Minimap for large graphs
- [ ] Auto-layout button: force-directed (e.g. `d3-force`) for organic clustering, or hierarchical (e.g. `dagre`/`elkjs`) for a top-down ordering when edges have a clear direction
- [ ] Tagging and color-coding independent of graph structure, with filter-by-tag
- [ ] Export current view to PNG/SVG; export the whole diagram to JSON
- [ ] Quick-capture: type a line, press Tab to spawn a connected child node (keyboard-first ideation, no mouse needed)
- [ ] Recent files list on a start screen

### Phase 3 — Stretch
- [ ] Snapshots / version history so you can rewind a diagram to an earlier state
- [ ] Semantic zoom: compound nodes auto-collapse to a summary card ("Idea C — 8 nodes") at low zoom and auto-expand at high zoom, instead of requiring an explicit double-click
- [ ] Backlinks: "what links to this node" across the whole file, including across sub-graphs
- [ ] Richer edge semantics: typed relationships (`depends on`, `contradicts`, `supports`) with distinct arrow styles
- [ ] Theming / plugin system

---

## 5. Visualization techniques to apply

- **Compound / nested graphs** (Phase 1, core mechanic): a node is both a single object from the outside and a full canvas from the inside. This is the feature that most differentiates MindGraph from a flat mind-map.
- **Force-directed layout** (Phase 2, optional auto-layout): nodes repel, edges act as springs — good for letting loosely related ideas find natural clusters.
- **Hierarchical / layered layout** (Phase 2, optional auto-layout): good for sub-graphs where edges have a clear cause → effect direction.
- **Minimap / overview+detail** (Phase 2): essential once a sub-graph has more nodes than fit on screen at once.
- **Semantic zoom** (Phase 3): reduces the friction of manually entering/exiting every compound node.

---

## 6. Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│         Main process        │  IPC   │        Renderer process       │
│  (Node.js, full fs access)  │◄──────►│   (React app, sandboxed)       │
│                              │        │                                │
│  • window & menu management │        │  • React Flow canvas          │
│  • native Open/Save dialogs │        │  • Zustand graph store        │
│  • read/write .mindgraph    │        │  • node detail panel, toolbar │
│  • recent-files store       │        │  • no direct fs access        │
└─────────────────────────────┘        └──────────────────────────────┘
              ▲
              │ contextBridge (preload.ts)
              │ exposes: openFile(), saveFile(), saveFileAs(), getRecents()
```

Renderer never touches the filesystem directly — all reads/writes go through the preload bridge to the main process, per Electron's security recommendations.

---

## 7. Suggested project structure

```
mindgraph/
├── package.json
├── electron/
│   ├── main.ts              # window creation, menu, app lifecycle
│   ├── preload.ts           # contextBridge API surface
│   └── fileHandlers.ts      # open/save/save-as logic, format versioning
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Canvas.tsx        # React Flow wrapper
│   │   ├── IdeaNode.tsx      # custom node renderer
│   │   ├── CompoundNode.tsx  # custom node renderer w/ "enter" affordance
│   │   ├── NodeDetailPanel.tsx
│   │   ├── Breadcrumbs.tsx   # sub-graph navigation trail
│   │   └── Toolbar.tsx
│   ├── store/
│   │   └── graphStore.ts     # Zustand store: current graph, navigation stack, dirty flag
│   ├── types/
│   │   └── graph.ts          # the interfaces from section 3
│   └── utils/
│       └── fileFormat.ts     # serialize/deserialize + version migration
├── docs/
│   └── MINDGRAPH-project-spec.md   # this file
└── tests/
```

---

## 8. Non-functional requirements

- **Cross-platform:** builds and runs on Windows 10/11 and macOS (Intel + Apple Silicon).
- **Fully offline:** no network calls anywhere in the core app.
- **Performance:** smooth pan/zoom (targeting 60fps) with up to ~500 nodes in a single sub-graph.
- **Data safety:** never lose unsaved work silently — dirty-state indicator, confirm-before-discard on close/open/new.
- **Recoverability:** file format is plain readable JSON, not a proprietary binary.

---

## 9. Suggested build order (for Claude Code)

Work through these roughly in order — each step should leave the app in a runnable state:

1. **Scaffold**: Electron + Vite + React + TypeScript project; confirm a blank window launches via `npm run dev` on your OS.
2. **Canvas**: integrate React Flow; support adding default nodes and dragging/panning/zooming.
3. **Detail panel**: clicking a node opens a side panel to edit its title and markdown description.
4. **Edges**: drag from a node handle to another node to create a directed edge.
5. **Save/Open**: wire the preload bridge and main-process file handlers; round-trip a graph to `.mindgraph` JSON and back.
6. **Compound nodes**: implement the "enter sub-graph" navigation with breadcrumbs back to parent graphs.
7. **Polish**: undo/redo, minimap, unsaved-changes guard, then package installers for both platforms.

---

## 10. Open questions to resolve during development

- Markdown vs. a lightweight rich-text editor for node descriptions?
- Inline vs. linked-file storage for sub-graphs (see section 3) — revisit if files get large.
- `dagre` vs `elkjs` vs `d3-force` for auto-layout, once Phase 2 starts.
- Single-window drill-down vs. opening a sub-graph in a new window?

---

## How to use this document

Point Claude Code at this file and ask it to start with step 1 of the build order in section 9. As the codebase grows, it's worth also keeping a short `CLAUDE.md` at the repo root — Claude Code reads that file automatically at the start of every session — with just the fast-changing operational facts (build/run/test commands, naming conventions, "always do X" rules). Keep this spec as the fuller reference and let `CLAUDE.md` stay short and link back to it, rather than duplicating everything here.
