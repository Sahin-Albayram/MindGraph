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

## Authorship

**Sahin Albayram** — author and maintainer. The project is his: he wrote the
specification that defines it, owns the design decisions behind it, and directs
and reviews the work as it is built.

The implementation is written with AI assistance, using Claude Code, working
from that specification and under his review. The spec anticipated this from the
outset — its choice of a single-language stack was made partly because "most of
the build is going to be AI-assisted" (§2).

Several of the design calls recorded in [CLAUDE.md](CLAUDE.md) came from
reviewing the running app rather than the code, and changed its direction —
in-place group expansion replaced a drill-down-only design that way.

## Documentation

- [Project specification](docs/MINDGRAPH-project-spec.md) — vision, data model,
  architecture, build order
- [CLAUDE.md](CLAUDE.md) — day-to-day conventions, and the reasoning behind
  decisions that are easy to undo by accident
