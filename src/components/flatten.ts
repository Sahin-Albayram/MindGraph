/**
 * Turns the nested document into the flat parent/child array React Flow needs.
 *
 * React Flow has no notion of a graph inside a node: it takes one list, where a
 * child names its container through `parentId` and positions itself relative to
 * it. So an expanded group becomes a sized container node, and its sub-graph's
 * nodes become children of it — recursively, for groups expanded inside groups.
 *
 * Two things this layer is responsible for:
 *
 * - **Identity.** A node id is unique only within its own graph, so once
 *   several graphs are flattened together an id alone is ambiguous. Every
 *   element is keyed by its full path from the root, and `parseRef` turns that
 *   back into the `{ path, id }` an edit needs.
 * - **Geometry.** Positions in the document are relative to the node's own
 *   graph; inside a container they must clear its header, and the container
 *   must be big enough to hold them.
 */

import type { Edge as FlowEdge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";

import type { ElementRef } from "../store/graphStore.js";
import type { Edge, Graph, GraphPath } from "../types/graph.js";
import type { FlowNodeData, MindGraphFlowNode } from "./flowTypes.js";

/** Node ids are UUIDs, so this cannot occur inside one. */
const SEP = "/";

/** Space between a container's edge and its contents. */
export const GROUP_PADDING = 18;
/** Room at the top of a container for its title. */
export const GROUP_HEADER = 46;

/**
 * Assumed footprint of a child when sizing its container. React Flow measures
 * nodes only after they render, so the container is sized from positions plus
 * this allowance; a child dragged past the edge simply grows the container on
 * the next render.
 */
const CHILD_WIDTH = 240;
const CHILD_HEIGHT = 78;

const MIN_GROUP_WIDTH = 260;
const MIN_GROUP_HEIGHT = 130;

export function refKey(path: GraphPath, id: string): string {
  return [...path, id].join(SEP);
}

export function parseRef(key: string): ElementRef {
  const parts = key.split(SEP);
  const id = parts.pop() ?? "";
  return { path: parts, id };
}

export interface FlattenResult {
  nodes: MindGraphFlowNode[];
  edges: FlowEdge[];
}

function toFlowEdge(edge: Edge, path: GraphPath): FlowEdge {
  return {
    id: refKey(path, edge.id),
    source: refKey(path, edge.source),
    target: refKey(path, edge.target),
    // The graph is directed, so every edge states which way it points.
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    // Spread conditionally: `exactOptionalPropertyTypes` rejects an explicit
    // `undefined` for an optional property.
    ...(edge.style === "dashed" ? { style: { strokeDasharray: "6 4" } } : {}),
  };
}

/** Container size that holds every child at its current position. */
function sizeFor(subgraph: Graph): { width: number; height: number } {
  let width = MIN_GROUP_WIDTH;
  let height = MIN_GROUP_HEIGHT;

  for (const child of subgraph.nodes) {
    width = Math.max(width, child.position.x + CHILD_WIDTH + GROUP_PADDING);
    height = Math.max(height, child.position.y + CHILD_HEIGHT + GROUP_PADDING);
  }

  return { width, height: height + GROUP_HEADER };
}

/**
 * Flattens `graph` — the one on screen, living at `basePath` — expanding any
 * group whose key is in `expanded`.
 */
export function flatten(
  graph: Graph,
  basePath: GraphPath,
  expanded: ReadonlySet<string>,
): FlattenResult {
  const nodes: MindGraphFlowNode[] = [];
  const edges: FlowEdge[] = [];

  const visit = (current: Graph, path: GraphPath, parentKey: string | null): void => {
    for (const node of current.nodes) {
      const key = refKey(path, node.id);
      const isOpen = node.type === "compound" && node.data.subgraph !== undefined && expanded.has(key);

      const flowNode: MindGraphFlowNode = {
        id: key,
        type: node.type,
        position: parentKey === null
          ? node.position
          : // Children sit relative to their container, clear of its title.
            {
              x: node.position.x + GROUP_PADDING,
              y: node.position.y + GROUP_HEADER,
            },
        data: {
          ...(node.data as FlowNodeData),
          // Render-time only: the document knows nothing about expansion.
          expanded: isOpen,
        },
        // No `extent: "parent"`: a child has to be draggable out of its
        // container, because dropping it elsewhere is how it changes graph.
        ...(parentKey === null ? {} : { parentId: parentKey }),
        ...(isOpen
          ? {
              style: sizeFor(node.data.subgraph!),
              // A container must not sit on top of its own children.
              zIndex: -1,
            }
          : {}),
      };

      nodes.push(flowNode);

      if (isOpen) visit(node.data.subgraph!, [...path, node.id], key);
    }

    for (const edge of current.edges) edges.push(toFlowEdge(edge, path));
  };

  visit(graph, basePath, null);
  return { nodes, edges };
}

/** A container's box in absolute canvas coordinates. */
export interface ContainerBox {
  /** Composite ref of the group node. */
  key: string;
  /** Path *inside* the group — where a node dropped here would live. */
  path: GraphPath;
  x: number;
  y: number;
  width: number;
  height: number;
  /** How deeply nested; the innermost match wins a drop. */
  depth: number;
}

/**
 * Absolute boxes of every expanded container, innermost last.
 *
 * Computed from the document rather than asked of React Flow: the same
 * geometry the flattener writes out is the geometry a drop has to be tested
 * against, and keeping both in one file stops them drifting apart.
 */
export function containerBoxes(
  graph: Graph,
  basePath: GraphPath,
  expanded: ReadonlySet<string>,
): ContainerBox[] {
  const boxes: ContainerBox[] = [];

  const visit = (current: Graph, path: GraphPath, originX: number, originY: number, depth: number): void => {
    for (const node of current.nodes) {
      const key = refKey(path, node.id);
      const subgraph = node.data.subgraph;
      if (node.type !== "compound" || !subgraph || !expanded.has(key)) continue;

      const { width, height } = sizeFor(subgraph);
      const x = originX + node.position.x;
      const y = originY + node.position.y;
      boxes.push({ key, path: [...path, node.id], x, y, width, height, depth });

      // Children are drawn inset by the container's padding and header, so
      // their own absolute origin starts there.
      visit(subgraph, [...path, node.id], x + GROUP_PADDING, y + GROUP_HEADER, depth + 1);
    }
  };

  visit(graph, basePath, 0, 0, 0);
  return boxes.sort((a, b) => a.depth - b.depth);
}

/** Absolute position of every node on the canvas, keyed by composite ref. */
export function absolutePositions(
  graph: Graph,
  basePath: GraphPath,
  expanded: ReadonlySet<string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const visit = (current: Graph, path: GraphPath, originX: number, originY: number): void => {
    for (const node of current.nodes) {
      const key = refKey(path, node.id);
      const x = originX + node.position.x;
      const y = originY + node.position.y;
      positions.set(key, { x, y });

      const subgraph = node.data.subgraph;
      if (node.type === "compound" && subgraph && expanded.has(key)) {
        visit(subgraph, [...path, node.id], x + GROUP_PADDING, y + GROUP_HEADER);
      }
    }
  };

  visit(graph, basePath, 0, 0);
  return positions;
}
