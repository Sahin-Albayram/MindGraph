/**
 * Derived reads over the store. Kept as plain functions of state so components
 * can pass them straight to `useGraphStore(...)` and re-render only when the
 * value they actually use changes.
 */

import type { Graph } from "../types/graph.js";
import { type Breadcrumb, breadcrumbs, resolveGraph } from "../utils/graphPath.js";
import type { GraphState } from "./graphStore.js";

/**
 * The graph currently on screen. Returns the identical object each call while
 * nothing changes, so it is safe to select directly.
 *
 * Falls back to the root if the path cannot be resolved: showing the top of the
 * document beats showing nothing.
 */
export function selectCurrentGraph(state: GraphState): Graph {
  return resolveGraph(state.root, state.path) ?? state.root;
}

export function selectBreadcrumbs(state: GraphState): Breadcrumb[] {
  return breadcrumbs(state.root, state.path);
}

export function selectIsDirty(state: GraphState): boolean {
  return state.root !== state.savedRoot;
}

export function selectCanUndo(state: GraphState): boolean {
  return state.past.length > 0;
}

export function selectCanRedo(state: GraphState): boolean {
  return state.future.length > 0;
}

export function selectIsAtRoot(state: GraphState): boolean {
  return state.path.length === 0;
}

/** Window-title text: document name, with the conventional dirty marker. */
export function selectDocumentTitle(state: GraphState): string {
  return `${state.root.name}${selectIsDirty(state) ? " •" : ""}`;
}
