/**
 * Navigating the nested-graph tree.
 *
 * A `GraphPath` is the list of compound-node ids walked from the root graph to
 * the graph currently on screen; an empty path means the root itself. The store
 * keeps the root graph plus one of these rather than a detached copy of the
 * visible sub-graph, so drill-down, undo/redo and save all act on one
 * authoritative tree.
 */

import type { Graph, GraphPath, Node } from "../types/graph.js";

/**
 * Walks `path` from `root`. Returns `null` if any step is missing — which
 * happens legitimately, e.g. after undoing the creation of a compound node the
 * user had drilled into.
 *
 * Generic over the graph type so it works unchanged on an Immer draft.
 */
export function resolveGraph<G extends Graph>(root: G, path: GraphPath): G | null {
  let graph: G = root;
  for (const nodeId of path) {
    const node: Node | undefined = graph.nodes.find((candidate) => candidate.id === nodeId);
    const subgraph = node?.data.subgraph;
    if (!subgraph) return null;
    graph = subgraph as G;
  }
  return graph;
}

/**
 * The longest prefix of `path` that still resolves. Used to keep the view on
 * solid ground after an undo or a file load, instead of showing nothing.
 */
export function repairPath(root: Graph, path: GraphPath): GraphPath {
  const valid: string[] = [];
  let graph: Graph = root;
  for (const nodeId of path) {
    const subgraph = graph.nodes.find((node) => node.id === nodeId)?.data.subgraph;
    if (!subgraph) break;
    valid.push(nodeId);
    graph = subgraph;
  }
  return valid.length === path.length ? path : valid;
}

export interface Breadcrumb {
  /** `null` identifies the root graph, which has no owning node. */
  nodeId: string | null;
  label: string;
  /** Path depth to pass to `navigateTo` to land here. */
  depth: number;
}

/** The trail from the root graph down to the graph `path` points at. */
export function breadcrumbs(root: Graph, path: GraphPath): Breadcrumb[] {
  const trail: Breadcrumb[] = [{ nodeId: null, label: root.name, depth: 0 }];

  let graph: Graph = root;
  for (const [index, nodeId] of path.entries()) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    const subgraph = node?.data.subgraph;
    if (!node || !subgraph) break;
    trail.push({ nodeId, label: node.data.title, depth: index + 1 });
    graph = subgraph;
  }

  return trail;
}

/** Every graph in the document, root first, depth-first through sub-graphs. */
export function allGraphs(root: Graph): Graph[] {
  const found: Graph[] = [];
  const visit = (graph: Graph): void => {
    found.push(graph);
    for (const node of graph.nodes) {
      if (node.data.subgraph) visit(node.data.subgraph);
    }
  };
  visit(root);
  return found;
}
