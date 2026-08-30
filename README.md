# MindGraph

A local, cross-platform desktop app for visual brainstorming with directed
graphs and nestable sub-graphs. No account, no server, no network.

Diagrams are saved as `.mindgraph` files — pretty-printed JSON, so they stay
readable, diffable and repairable by hand.

## Status

Early development. The data model, file format and validation layer are in
place and tested; the Electron/React application shell is next.

## Requirements

- Node 22 (see `.nvmrc`)

## Getting started

```bash
npm install
npm test
```

## Documentation

- [Project specification](docs/MINDGRAPH-project-spec.md) — vision, data model,
  architecture, build order
- [CLAUDE.md](CLAUDE.md) — day-to-day conventions and commands
