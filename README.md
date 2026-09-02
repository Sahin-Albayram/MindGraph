# MindGraph

A local, cross-platform desktop app for visual brainstorming with directed
graphs and nestable sub-graphs. No account, no server, no network.

Diagrams are saved as `.mindgraph` files — pretty-printed JSON, so they stay
readable, diffable and repairable by hand.

## Status

Phase 1 of the [specification](docs/MINDGRAPH-project-spec.md) is complete, plus
in-place group expansion from Phase 3:

- Add, edit, drag and delete nodes on an infinite canvas
- Draw directed edges between nodes, label them, mark them tentative
- A detail panel for each node's title and markdown description
- Groups that hold a graph of their own — expand one in place to work inside it,
  or focus it to give it the whole canvas with breadcrumbs
- Drag nodes between groups; add nodes directly into a group
- Save and open `.mindgraph` files, with guards against losing unsaved work
- Undo/redo scoped to edits, so navigation and panning never fill the history

Still to come: a minimap, auto-layout, search across nested graphs, tag
filtering, and export. See the build order in [CLAUDE.md](CLAUDE.md).

## Requirements

- Node 22 (see `.nvmrc`)

## Getting started

```bash
npm install
npm run dev
```

The first `npm install` downloads the Electron binary (~100 MB), so it takes a
while. `npm test` runs the unit suite without launching the app;
`npm run package` builds installers for the current platform.

## About this project & my role (AI Written)

MindGraph is a personal desktop app I’ve been building. My goal was simple: create a truly local, document-based tool with zero accounts, zero servers, and zero network calls.


To actually build the app, I use Claude Code as a build-time pair programmer. I focus on the architecture, testing, and design decisions, while Claude helps me iterate on the code itself. However, that AI assistance is strictly for the development phase—the app you actually install and run is entirely offline and model-free.

## Documentation

- [Project specification](docs/MINDGRAPH-project-spec.md) — vision, data model,
  architecture, build order
- [CLAUDE.md](CLAUDE.md) — day-to-day conventions, and the reasoning behind
  decisions that are easy to undo by accident
