/**
 * MindGraph core data model.
 *
 * These interfaces are the single source of truth for the shape of a
 * `.mindgraph` document. The validator in `src/utils/fileFormat.ts` checks
 * untrusted JSON against exactly this shape at runtime — if you change
 * anything here, change the validator to match.
 *
 * See docs/MINDGRAPH-project-spec.md section 3.
 */

/** Bumped only on a breaking change to the on-disk schema. */
export const FORMAT_VERSION = 1;

/** The magic string identifying a MindGraph document. */
export const APP_NAME = "MindGraph";

/** Root object serialized to a `.mindgraph` file. */
export interface GraphFile {
  formatVersion: number;
  app: typeof APP_NAME;
  graph: Graph;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Graph {
  id: string;
  name: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
  viewport: Viewport;
  nodes: Node[];
  edges: Edge[];
}

export type NodeType = "idea" | "compound";

export interface Position {
  x: number;
  y: number;
}

export interface NodeData {
  title: string;
  /** Markdown source. */
  description?: string;
  /** Tag colour as a CSS colour string; presentation only. */
  color?: string;
  tags?: string[];
  /** Present if and only if the owning node's `type` is `"compound"`. */
  subgraph?: Graph;
}

export interface Node {
  id: string;
  type: NodeType;
  position: Position;
  data: NodeData;
}

export type EdgeStyle = "solid" | "dashed";

export interface Edge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** `"dashed"` marks a tentative or weak connection. Defaults to `"solid"`. */
  style?: EdgeStyle;
}

/** A compound node, narrowed so `data.subgraph` is known to be present. */
export interface CompoundNode extends Node {
  type: "compound";
  data: NodeData & { subgraph: Graph };
}

export function isCompoundNode(node: Node): node is CompoundNode {
  return node.type === "compound" && node.data.subgraph !== undefined;
}

/**
 * Path to a nested graph, as a list of compound-node ids walked from the root.
 * An empty path denotes the root graph itself.
 *
 * The Zustand store holds the root `Graph` plus one of these, rather than a
 * detached copy of the graph currently on screen — so drill-down navigation,
 * undo/redo and save all operate on one authoritative tree.
 */
export type GraphPath = readonly string[];
