/**
 * Constructors for well-formed graph objects. Everything that creates a node,
 * edge or graph should go through here so defaults stay in one place and every
 * object we build is guaranteed to pass validation.
 */

import {
  APP_NAME,
  FORMAT_VERSION,
  type Edge,
  type Graph,
  type GraphFile,
  type Node,
  type Position,
  type Viewport,
} from "../types/graph.js";
import { newId } from "./id.js";

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

function now(): string {
  return new Date().toISOString();
}

export function createGraph(options: { name?: string } = {}): Graph {
  const timestamp = now();
  return {
    id: newId(),
    name: options.name ?? "Untitled",
    createdAt: timestamp,
    updatedAt: timestamp,
    viewport: { ...DEFAULT_VIEWPORT },
    nodes: [],
    edges: [],
  };
}

export function createIdeaNode(options: {
  title?: string;
  position?: Position;
  description?: string;
}): Node {
  const node: Node = {
    id: newId(),
    type: "idea",
    position: options.position ?? { x: 0, y: 0 },
    data: { title: options.title ?? "New idea" },
  };
  if (options.description !== undefined) node.data.description = options.description;
  return node;
}

/**
 * A compound node always carries a subgraph, even an empty one — the validator
 * rejects a compound node without it.
 */
export function createCompoundNode(options: {
  title?: string;
  position?: Position;
  subgraph?: Graph;
}): Node {
  const title = options.title ?? "New group";
  return {
    id: newId(),
    type: "compound",
    position: options.position ?? { x: 0, y: 0 },
    data: {
      title,
      subgraph: options.subgraph ?? createGraph({ name: title }),
    },
  };
}

export function createEdge(options: {
  source: string;
  target: string;
  label?: string;
  style?: Edge["style"];
}): Edge {
  const edge: Edge = {
    id: newId(),
    source: options.source,
    target: options.target,
  };
  if (options.label !== undefined) edge.label = options.label;
  if (options.style !== undefined) edge.style = options.style;
  return edge;
}

export function createGraphFile(graph: Graph = createGraph()): GraphFile {
  return { formatVersion: FORMAT_VERSION, app: APP_NAME, graph };
}

/** Returns a copy of `graph` with `updatedAt` refreshed. */
export function touch(graph: Graph): Graph {
  return { ...graph, updatedAt: now() };
}
