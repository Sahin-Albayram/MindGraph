/**
 * The single authoritative document store.
 *
 * Shape: the **root graph** plus a `GraphPath` naming the sub-graph on screen —
 * never a detached copy of the visible graph. Drill-down, undo/redo and save
 * therefore all operate on one tree, and none of them need to reconcile copies.
 *
 * ## Undo/redo
 *
 * History is a stack of previous root-graph *references*, not diffs. That is
 * affordable because Immer gives structural sharing: an edit deep in a
 * sub-graph rebuilds only the spine down to the change, so each entry shares
 * almost everything with its neighbours.
 *
 * Choosing this over a middleware (zundo) buys explicit control over what is
 * undoable, which this app genuinely needs:
 *
 * - **Edits** are undoable (spec section 4: "undo/redo for node and edge edits").
 * - **Navigation** is not. Drilling into a sub-graph is not a document change.
 * - **Viewport** changes are not. Panning is not an edit, and recording it
 *   would bury real edits under a drift of camera moves.
 * - **Drags coalesce.** A pointer drag emits a position update per frame; those
 *   collapse into one history entry via `coalesceKey`, so one undo reverses one
 *   gesture rather than one frame.
 */

import { produce } from "immer";
import { create } from "zustand";

import type { Edge, Graph, GraphPath, Node, NodeData, Position, Viewport } from "../types/graph.js";
import { createGraph, createEdge as makeEdge } from "../utils/factories.js";
import { repairPath, resolveGraph } from "../utils/graphPath.js";

/** Undo depth. Entries are cheap (shared structure), so this is generous. */
export const MAX_HISTORY = 200;

export interface GraphState {
  /** The whole document. Never replaced except through the actions below. */
  root: Graph;
  /** Compound-node ids from the root to the graph on screen. */
  path: GraphPath;
  /** Absolute path on disk, or `null` for a document never saved. */
  filePath: string | null;
  /**
   * The root as it was when last saved or opened. Dirty state is a reference
   * comparison against it, so undoing back to the saved state correctly reports
   * clean — history holds the very same object.
   */
  savedRoot: Graph | null;

  past: Graph[];
  future: Graph[];
  /** Identifies the gesture currently being coalesced into one history entry. */
  coalesceKey: string | null;
}

export interface GraphActions {
  // Navigation — never recorded in history.
  enterSubgraph: (nodeId: string) => void;
  exitSubgraph: () => void;
  navigateTo: (depth: number) => void;

  // Viewport — never recorded in history.
  setViewport: (viewport: Viewport) => void;

  // Node edits.
  addNode: (node: Node) => void;
  updateNodeData: (nodeId: string, patch: Partial<NodeData>) => void;
  moveNode: (nodeId: string, position: Position, options?: { coalesce?: boolean }) => void;
  removeNode: (nodeId: string) => void;
  convertToCompound: (nodeId: string) => void;

  // Edge edits.
  connect: (source: string, target: string, options?: { label?: string; style?: Edge["style"] }) => void;
  addEdge: (edge: Edge) => void;
  updateEdge: (edgeId: string, patch: Partial<Omit<Edge, "id">>) => void;
  removeEdge: (edgeId: string) => void;

  /** Ends a coalescing gesture, e.g. on pointer-up. */
  endGesture: () => void;

  // Document lifecycle.
  newDocument: (name?: string) => void;
  loadDocument: (graph: Graph, filePath: string | null) => void;
  markSaved: (filePath: string) => void;

  undo: () => void;
  redo: () => void;
}

export type GraphStore = GraphState & GraphActions;

function initialState(): GraphState {
  const root = createGraph({ name: "Untitled" });
  return {
    root,
    path: [],
    filePath: null,
    savedRoot: root,
    past: [],
    future: [],
    coalesceKey: null,
  };
}

export const useGraphStore = create<GraphStore>()((set, get) => {
  /**
   * Applies `recipe` to the graph the path points at and records the result in
   * history. A recipe that changes nothing leaves history untouched, so no-op
   * interactions never cost the user an undo press.
   */
  function edit(recipe: (graph: Graph) => void, options?: { coalesceKey?: string }): void {
    set((state) => {
      const next = produce(state.root, (draft) => {
        const target = resolveGraph(draft, state.path);
        // The view can only point at a missing graph if state was corrupted;
        // dropping the edit is safer than writing to the wrong graph.
        if (!target) return;
        recipe(target);
        const stamp = new Date().toISOString();
        target.updatedAt = stamp;
        draft.updatedAt = stamp;
      });

      if (next === state.root) return {};

      const key = options?.coalesceKey;
      const continuing = key !== undefined && key === state.coalesceKey;

      return {
        root: next,
        // While a gesture continues, the entry already on the stack holds the
        // state from before it began — exactly what one undo should restore.
        past: continuing ? state.past : [...state.past, state.root].slice(-MAX_HISTORY),
        future: [],
        coalesceKey: key ?? null,
      };
    });
  }

  /** Changes the visible graph or camera without touching history. */
  function editSilently(recipe: (graph: Graph) => void): void {
    set((state) => {
      const next = produce(state.root, (draft) => {
        const target = resolveGraph(draft, state.path);
        if (target) recipe(target);
      });
      return next === state.root ? {} : { root: next };
    });
  }

  return {
    ...initialState(),

    enterSubgraph: (nodeId) => {
      const { root, path } = get();
      const graph = resolveGraph(root, path);
      const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
      if (!node?.data.subgraph) return;
      set({ path: [...path, nodeId], coalesceKey: null });
    },

    exitSubgraph: () => {
      const { path } = get();
      if (path.length === 0) return;
      set({ path: path.slice(0, -1), coalesceKey: null });
    },

    navigateTo: (depth) => {
      const { path } = get();
      if (depth < 0 || depth > path.length) return;
      set({ path: path.slice(0, depth), coalesceKey: null });
    },

    setViewport: (viewport) => {
      editSilently((graph) => {
        graph.viewport = { ...viewport };
      });
    },

    addNode: (node) => {
      edit((graph) => {
        graph.nodes.push(node);
      });
    },

    updateNodeData: (nodeId, patch) => {
      edit((graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) return;
        Object.assign(node.data, patch);
      });
    },

    moveNode: (nodeId, position, options) => {
      edit(
        (graph) => {
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) return;
          node.position = { ...position };
        },
        // Every frame of one drag shares a key, so the whole drag is one undo.
        options?.coalesce ? { coalesceKey: `move:${nodeId}` } : undefined,
      );
    },

    removeNode: (nodeId) => {
      edit((graph) => {
        const index = graph.nodes.findIndex((candidate) => candidate.id === nodeId);
        if (index === -1) return;
        graph.nodes.splice(index, 1);
        // Edges to a deleted node would dangle, and the file validator rejects
        // that, so they go with it.
        graph.edges = graph.edges.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId,
        );
      });
    },

    convertToCompound: (nodeId) => {
      edit((graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node || node.type === "compound") return;
        node.type = "compound";
        node.data.subgraph = createGraph({ name: node.data.title });
      });
    },

    connect: (source, target, options) => {
      edit((graph) => {
        const hasSource = graph.nodes.some((node) => node.id === source);
        const hasTarget = graph.nodes.some((node) => node.id === target);
        if (!hasSource || !hasTarget) return;
        // Edges live in the graph that owns both endpoints; a duplicate in the
        // same direction carries no extra meaning.
        const exists = graph.edges.some(
          (edge) => edge.source === source && edge.target === target,
        );
        if (exists) return;
        graph.edges.push(makeEdge({ source, target, ...options }));
      });
    },

    addEdge: (edge) => {
      edit((graph) => {
        graph.edges.push(edge);
      });
    },

    updateEdge: (edgeId, patch) => {
      edit((graph) => {
        const edge = graph.edges.find((candidate) => candidate.id === edgeId);
        if (!edge) return;
        Object.assign(edge, patch);
      });
    },

    removeEdge: (edgeId) => {
      edit((graph) => {
        const index = graph.edges.findIndex((candidate) => candidate.id === edgeId);
        if (index === -1) return;
        graph.edges.splice(index, 1);
      });
    },

    endGesture: () => set({ coalesceKey: null }),

    newDocument: (name) => {
      const root = createGraph(name === undefined ? {} : { name });
      set({ root, path: [], filePath: null, savedRoot: root, past: [], future: [], coalesceKey: null });
    },

    loadDocument: (graph, filePath) => {
      set({
        root: graph,
        path: [],
        filePath,
        savedRoot: graph,
        past: [],
        future: [],
        coalesceKey: null,
      });
    },

    markSaved: (filePath) => set((state) => ({ savedRoot: state.root, filePath })),

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1);
        if (!previous) return {};
        return {
          root: previous,
          past: state.past.slice(0, -1),
          future: [state.root, ...state.future],
          // The undone edit may have removed the compound node being viewed.
          path: repairPath(previous, state.path),
          coalesceKey: null,
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return {};
        return {
          root: next,
          past: [...state.past, state.root].slice(-MAX_HISTORY),
          future: rest,
          path: repairPath(next, state.path),
          coalesceKey: null,
        };
      }),
  };
});
