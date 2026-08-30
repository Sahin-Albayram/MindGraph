# MindGraph

A local, cross-platform desktop app for visual brainstorming with directed
graphs and nestable sub-graphs. No account, no server, no network.

Diagrams are saved as `.mindgraph` files — pretty-printed JSON, so they stay
readable, diffable and repairable by hand.

## Status

Early development. The data model, file format and validation layer are in
place and tested, and the Electron/React shell launches. The canvas is next —
see the build order in `CLAUDE.md`.

## Requirements

- Node 22 (see `.nvmrc`)

## Getting started

```bash
npm install
npm run dev
```

The first `npm install` downloads the Electron binary (~100 MB), so it takes a
while. `npm test` runs the unit suite without launching the app.

## Documentation

- [Project specification](docs/MINDGRAPH-project-spec.md) — vision, data model,
  architecture, build order
- [CLAUDE.md](CLAUDE.md) — day-to-day conventions and commands
