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

/**
 * The presentation fields a node's detail panel may edit. `subgraph` is
 * deliberately excluded — nesting is managed by its own actions, not patched.
 *
 * An explicit `undefined` removes the field, so clearing a description leaves
 * no empty string behind in the saved file.
 */
export type NodeDataPatch = {
  [K in "title" | "description" | "color" | "tags"]?: NodeData[K] | undefined;
};

/**
 * The editable properties of an edge. Endpoints are not among them: re-pointing
 * an edge is a structural change, not a property edit.
 */
/**
 * An element identified by the graph that owns it. Node ids are unique only
 * within their own graph, so once several graphs are on screen at once an id
 * alone no longer identifies anything.
 */
export interface ElementRef {
  path: GraphPath;
  id: string;
}

export type EdgePatch = {
  [K in "label" | "style"]?: Edge[K] | undefined;
};

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
  setViewport: (viewport: Viewport, path?: GraphPath) => void;

  // Node edits.
  addNode: (node: Node, path?: GraphPath) => void;
  /**
   * `options.coalesce` names the field being edited, so a burst of typing
   * collapses into one history entry the same way a drag does. The editor must
   * call `endGesture()` when the burst ends (blur, or an idle pause).
   */
  updateNodeData: (
    nodeId: string,
    patch: NodeDataPatch,
    options?: { coalesce?: string; path?: GraphPath },
  ) => void;
  moveNode: (
    nodeId: string,
    position: Position,
    options?: { coalesce?: boolean; path?: GraphPath },
  ) => void;
  removeNode: (nodeId: string, path?: GraphPath) => void;
  convertToCompound: (nodeId: string, path?: GraphPath) => void;

  // Edge edits.
  connect: (
    source: string,
    target: string,
    options?: { label?: string; style?: Edge["style"]; path?: GraphPath },
  ) => void;
  addEdge: (edge: Edge, path?: GraphPath) => void;
  /** `options.coalesce` groups a burst of typing, exactly as for node data. */
  updateEdge: (
    edgeId: string,
    patch: EdgePatch,
    options?: { coalesce?: string; path?: GraphPath },
  ) => void;
  removeEdge: (edgeId: string, path?: GraphPath) => void;
  /**
   * Removes nodes and edges as one transaction, so a single delete gesture
   * costs a single undo. React Flow reports node and edge deletions through
   * separate callbacks; routing both here keeps them in one history entry.
   */
  deleteElements: (elements: {
    nodeIds?: readonly string[];
    edgeIds?: readonly string[];
    /** Elements spanning several graphs, as shown by expanded groups. */
    refs?: { nodes?: readonly ElementRef[]; edges?: readonly ElementRef[] };
    path?: GraphPath;
  }) => void;

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
  function editRoot(
    recipe: (root: Graph) => void,
    options?: { coalesceKey?: string; stampPath?: GraphPath },
  ): void {
    set((state) => {
      const edited = produce(state.root, (draft) => {
        recipe(draft);
      });

      // Nothing changed: no history entry, and — importantly — no timestamp
      // either. Stamping before this check would make every no-op look like an
      // edit, because the new timestamp is itself a change.
      if (edited === state.root) return {};

      const stamp = new Date().toISOString();
      const next = produce(edited, (draft) => {
        const target = resolveGraph(draft, options?.stampPath ?? state.path);
        if (target) target.updatedAt = stamp;
        draft.updatedAt = stamp;
      });

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

  /**
   * Applies `recipe` to one graph — by default the one on screen, or any other
   * named by `options.path`.
   *
   * An explicit path matters now that several graphs can be visible at once:
   * an expanded group shows its children in place, so "the current graph" is no
   * longer enough to say where an edit lands.
   */
  function edit(
    recipe: (graph: Graph) => void,
    options?: { coalesceKey?: string; path?: GraphPath },
  ): void {
    const path = options?.path ?? get().path;
    editRoot(
      (draft) => {
        const target = resolveGraph(draft, path);
        // A missing graph means corrupted state; dropping the edit is safer
        // than writing to the wrong graph.
        if (target) recipe(target);
      },
      options?.coalesceKey === undefined
        ? { stampPath: path }
        : { coalesceKey: options.coalesceKey, stampPath: path },
    );
  }

  /**
   * Changes the visible graph or camera without touching history.
   *
   * The camera lives in the document, so moving it does rewrite `root`. It must
   * not, however, make a saved document look unsaved: panning around a file and
   * closing it should not raise "do you want to save?", and a prompt the user
   * learns to dismiss is worse than no prompt at all. So when the document was
   * clean, `savedRoot` moves with it and stays clean.
   */
  function editSilently(recipe: (graph: Graph) => void, path?: GraphPath): void {
    set((state) => {
      const next = produce(state.root, (draft) => {
        const target = resolveGraph(draft, path ?? state.path);
        if (target) recipe(target);
      });
      if (next === state.root) return {};

      const wasClean = state.root === state.savedRoot;
      return wasClean ? { root: next, savedRoot: next } : { root: next };
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

    setViewport: (viewport, path) => {
      editSilently((graph) => {
        graph.viewport = { ...viewport };
      }, path);
    },

    addNode: (node, path) => {
      edit(
        (graph) => {
          graph.nodes.push(node);
        },
        path === undefined ? undefined : { path },
      );
    },

    updateNodeData: (nodeId, patch, options) => {
      edit(
        (graph) => {
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) return;

          const data = node.data as unknown as Record<string, unknown>;
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
              // Only delete a key that is actually there; removing an absent
              // one would still count as a change under Immer.
              if (key in data) delete data[key];
            } else if (data[key] !== value) {
              data[key] = value;
            }
          }
        },
        {
          ...(options?.coalesce === undefined
            ? {}
            : { coalesceKey: `data:${nodeId}:${options.coalesce}` }),
          ...(options?.path === undefined ? {} : { path: options.path }),
        },
      );
    },

    moveNode: (nodeId, position, options) => {
      edit(
        (graph) => {
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) return;
          // Skip a write that changes nothing. React Flow ends every drag with
          // a second position change at the same coordinates (dragging: false);
          // assigning an equal-but-new object would count as an edit under
          // Immer and cost the user a second, empty undo press.
          if (node.position.x === position.x && node.position.y === position.y) return;
          node.position = { ...position };
        },
        {
          // Every frame of one drag shares a key, so the whole drag is one undo.
          ...(options?.coalesce ? { coalesceKey: `move:${nodeId}` } : {}),
          ...(options?.path === undefined ? {} : { path: options.path }),
        },
      );
    },

    removeNode: (nodeId, path) => {
      edit(
        (graph) => {
          const index = graph.nodes.findIndex((candidate) => candidate.id === nodeId);
          if (index === -1) return;
          graph.nodes.splice(index, 1);
          // Edges to a deleted node would dangle, and the file validator
          // rejects that, so they go with it.
          graph.edges = graph.edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId,
          );
        },
        path === undefined ? undefined : { path },
      );
    },

    convertToCompound: (nodeId, path) => {
      edit(
        (graph) => {
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          if (!node || node.type === "compound") return;
          node.type = "compound";
          node.data.subgraph = createGraph({ name: node.data.title });
        },
        path === undefined ? undefined : { path },
      );
    },

    connect: (source, target, options) => {
      edit(
        (graph) => {
        // A node related to itself says nothing, and renders as a stub. Files
        // containing one still load — the reader stays liberal, the editor
        // conservative — but the editor will not create one.
        if (source === target) return;

        const hasSource = graph.nodes.some((node) => node.id === source);
        const hasTarget = graph.nodes.some((node) => node.id === target);
        if (!hasSource || !hasTarget) return;
        // Edges live in the graph that owns both endpoints; a duplicate in the
        // same direction carries no extra meaning.
        const exists = graph.edges.some(
          (edge) => edge.source === source && edge.target === target,
        );
        if (exists) return;
          const { path: _ignored, ...edgeOptions } = options ?? {};
          graph.edges.push(makeEdge({ source, target, ...edgeOptions }));
        },
        options?.path === undefined ? undefined : { path: options.path },
      );
    },

    addEdge: (edge, path) => {
      edit(
        (graph) => {
          graph.edges.push(edge);
        },
        path === undefined ? undefined : { path },
      );
    },

    updateEdge: (edgeId, patch, options) => {
      edit(
        (graph) => {
          const edge = graph.edges.find((candidate) => candidate.id === edgeId);
          if (!edge) return;

          const record = edge as unknown as Record<string, unknown>;
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
              if (key in record) delete record[key];
            } else if (record[key] !== value) {
              record[key] = value;
            }
          }
        },
        {
          ...(options?.coalesce === undefined
            ? {}
            : { coalesceKey: `edge:${edgeId}:${options.coalesce}` }),
          ...(options?.path === undefined ? {} : { path: options.path }),
        },
      );
    },

    removeEdge: (edgeId, path) => {
      edit(
        (graph) => {
          const index = graph.edges.findIndex((candidate) => candidate.id === edgeId);
          if (index === -1) return;
          graph.edges.splice(index, 1);
        },
        path === undefined ? undefined : { path },
      );
    },

    deleteElements: ({ nodeIds = [], edgeIds = [], refs, path }) => {
      // Callers may address elements in one graph (nodeIds/edgeIds) or across
      // several at once (refs) — an expanded group puts more than one graph on
      // screen, and one Delete press must still be one undo.
      const targetPath = path ?? get().path;
      const key = (p: GraphPath) => p.join("\u0000");

      const byPath = new Map<string, { path: GraphPath; nodes: Set<string>; edges: Set<string> }>();
      const bucket = (p: GraphPath) => {
        const k = key(p);
        let found = byPath.get(k);
        if (!found) {
          found = { path: p, nodes: new Set(), edges: new Set() };
          byPath.set(k, found);
        }
        return found;
      };

      for (const id of nodeIds) bucket(targetPath).nodes.add(id);
      for (const id of edgeIds) bucket(targetPath).edges.add(id);
      for (const ref of refs?.nodes ?? []) bucket(ref.path).nodes.add(ref.id);
      for (const ref of refs?.edges ?? []) bucket(ref.path).edges.add(ref.id);

      const groups = [...byPath.values()].filter(
        (group) => group.nodes.size > 0 || group.edges.size > 0,
      );
      if (groups.length === 0) return;

      editRoot(
        (root) => {
          for (const group of groups) {
            const graph = resolveGraph(root, group.path);
            if (!graph) continue;

            graph.nodes = graph.nodes.filter((node) => !group.nodes.has(node.id));
            graph.edges = graph.edges.filter(
              (edge) =>
                !group.edges.has(edge.id) &&
                // Edges left hanging off a deleted node go with it; the file
                // validator rejects a dangling reference.
                !group.nodes.has(edge.source) &&
                !group.nodes.has(edge.target),
            );
          }
        },
        { stampPath: groups[0]!.path },
      );
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
