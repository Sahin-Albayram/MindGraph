/**
 * Serialization, validation and version migration for `.mindgraph` files.
 *
 * A `.mindgraph` file is a `GraphFile` as pretty-printed JSON. Because the
 * format is meant to stay hand-inspectable and hand-repairable (spec section
 * 8), `deserialize` never throws and never trusts its input: it reports every
 * problem it finds, with a JSON path, so the UI can tell the user precisely
 * what is wrong with a damaged file rather than just failing to open it.
 */

import {
  APP_NAME,
  FORMAT_VERSION,
  type Edge,
  type Graph,
  type GraphFile,
  type Node,
  type Viewport,
} from "../types/graph.js";

/** Guards against a stack overflow on a pathologically nested file. */
export const MAX_NESTING_DEPTH = 64;

export interface ParseSuccess {
  ok: true;
  file: GraphFile;
  /** Non-fatal oddities: unknown fields, unparseable timestamps, etc. */
  warnings: string[];
}

export interface ParseFailure {
  ok: false;
  errors: string[];
  warnings: string[];
}

export type ParseResult = ParseSuccess | ParseFailure;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const INDENT = 2;

export function serializeFile(file: GraphFile): string {
  return JSON.stringify(file, null, INDENT) + "\n";
}

/** Wraps `graph` in a current-version envelope and serializes it. */
export function serialize(graph: Graph): string {
  return serializeFile({ formatVersion: FORMAT_VERSION, app: APP_NAME, graph });
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** Transforms a document from version N to version N+1. Keyed by N. */
type Migration = (file: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registry of upgrade steps. Empty while FORMAT_VERSION is 1 — the chain
 * exists now so that adding version 2 is a one-line change here plus a test,
 * rather than a refactor under time pressure.
 */
const MIGRATIONS: Record<number, Migration> = {};

function migrate(
  file: Record<string, unknown>,
  from: number,
  problems: Problems,
): Record<string, unknown> {
  let current = file;
  for (let v = from; v < FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      problems.err("formatVersion", `no migration available from format v${v} to v${v + 1}`);
      return current;
    }
    current = step(current);
    problems.warnings.push(`upgraded document from format v${v} to v${v + 1}`);
  }
  return current;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

class Problems {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];

  err(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  warn(path: string, message: string): void {
    this.warnings.push(`${path}: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reports any keys we do not recognise, so hand-edits and format drift surface. */
function checkUnknownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  path: string,
  p: Problems,
): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) p.warn(`${path}.${key}`, "unknown field, preserved as-is");
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  p: Problems,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
): void {
  const v = value[key];
  if (typeof v !== "string") {
    p.err(`${path}.${key}`, `expected a string, got ${describe(v)}`);
  } else if (!allowEmpty && v.length === 0) {
    p.err(`${path}.${key}`, "must not be empty");
  }
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  p: Problems,
): void {
  if (value[key] !== undefined && typeof value[key] !== "string") {
    p.err(`${path}.${key}`, `expected a string, got ${describe(value[key])}`);
  }
}

function requireFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  path: string,
  p: Problems,
): void {
  const v = value[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    p.err(`${path}.${key}`, `expected a finite number, got ${describe(v)}`);
  }
}

function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `${typeof value} (${JSON.stringify(value)?.slice(0, 40) ?? "?"})`;
}

function checkTimestamp(
  value: Record<string, unknown>,
  key: string,
  path: string,
  p: Problems,
): void {
  const v = value[key];
  if (typeof v !== "string") {
    p.err(`${path}.${key}`, `expected an ISO 8601 timestamp string, got ${describe(v)}`);
    return;
  }
  if (Number.isNaN(Date.parse(v))) {
    p.warn(`${path}.${key}`, `"${v}" is not a parseable date`);
  }
}

const VIEWPORT_KEYS = ["x", "y", "zoom"] as const;

function validateViewport(value: unknown, path: string, p: Problems): void {
  if (!isRecord(value)) {
    p.err(path, `expected an object, got ${describe(value)}`);
    return;
  }
  checkUnknownKeys(value, VIEWPORT_KEYS, path, p);
  requireFiniteNumber(value, "x", path, p);
  requireFiniteNumber(value, "y", path, p);
  requireFiniteNumber(value, "zoom", path, p);
  const zoom = value["zoom"];
  if (typeof zoom === "number" && Number.isFinite(zoom) && zoom <= 0) {
    p.err(`${path}.zoom`, `must be greater than 0, got ${zoom}`);
  }
}

const POSITION_KEYS = ["x", "y"] as const;

function validatePosition(value: unknown, path: string, p: Problems): void {
  if (!isRecord(value)) {
    p.err(path, `expected an object, got ${describe(value)}`);
    return;
  }
  checkUnknownKeys(value, POSITION_KEYS, path, p);
  requireFiniteNumber(value, "x", path, p);
  requireFiniteNumber(value, "y", path, p);
}

const EDGE_KEYS = ["id", "source", "target", "label", "style"] as const;
const EDGE_STYLES = ["solid", "dashed"];

function validateEdge(value: unknown, path: string, p: Problems): void {
  if (!isRecord(value)) {
    p.err(path, `expected an object, got ${describe(value)}`);
    return;
  }
  checkUnknownKeys(value, EDGE_KEYS, path, p);
  requireString(value, "id", path, p, { allowEmpty: false });
  requireString(value, "source", path, p, { allowEmpty: false });
  requireString(value, "target", path, p, { allowEmpty: false });
  optionalString(value, "label", path, p);
  if (value["style"] !== undefined && !EDGE_STYLES.includes(value["style"] as string)) {
    p.err(`${path}.style`, `expected one of ${EDGE_STYLES.join(" | ")}, got ${describe(value["style"])}`);
  }
}

const NODE_KEYS = ["id", "type", "position", "data"] as const;
const NODE_DATA_KEYS = ["title", "description", "color", "tags", "subgraph"] as const;
const NODE_TYPES = ["idea", "compound"];

function validateNode(
  value: unknown,
  path: string,
  p: Problems,
  depth: number,
  seenNodeIds: Set<string>,
): void {
  if (!isRecord(value)) {
    p.err(path, `expected an object, got ${describe(value)}`);
    return;
  }
  checkUnknownKeys(value, NODE_KEYS, path, p);
  requireString(value, "id", path, p, { allowEmpty: false });
  validatePosition(value["position"], `${path}.position`, p);

  const type = value["type"];
  if (typeof type !== "string" || !NODE_TYPES.includes(type)) {
    p.err(`${path}.type`, `expected one of ${NODE_TYPES.join(" | ")}, got ${describe(type)}`);
  }

  const id = value["id"];
  if (typeof id === "string") {
    if (seenNodeIds.has(id)) {
      p.warn(`${path}.id`, `id "${id}" is also used elsewhere in this document`);
    }
    seenNodeIds.add(id);
  }

  const data = value["data"];
  if (!isRecord(data)) {
    p.err(`${path}.data`, `expected an object, got ${describe(data)}`);
    return;
  }
  checkUnknownKeys(data, NODE_DATA_KEYS, `${path}.data`, p);
  requireString(data, "title", `${path}.data`, p);
  optionalString(data, "description", `${path}.data`, p);
  optionalString(data, "color", `${path}.data`, p);

  const tags = data["tags"];
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      p.err(`${path}.data.tags`, `expected an array, got ${describe(tags)}`);
    } else {
      tags.forEach((tag, i) => {
        if (typeof tag !== "string") {
          p.err(`${path}.data.tags[${i}]`, `expected a string, got ${describe(tag)}`);
        }
      });
    }
  }

  // A compound node is defined by carrying a subgraph; an idea node by not
  // carrying one. Anything else is a bug in whatever wrote the file.
  const subgraph = data["subgraph"];
  if (type === "compound") {
    if (subgraph === undefined) {
      p.err(`${path}.data.subgraph`, 'required when type is "compound"');
    } else {
      validateGraph(subgraph, `${path}.data.subgraph`, p, depth + 1, seenNodeIds);
    }
  } else if (subgraph !== undefined) {
    p.err(`${path}.data.subgraph`, 'only allowed when type is "compound"');
  }
}

const GRAPH_KEYS = [
  "id",
  "name",
  "createdAt",
  "updatedAt",
  "viewport",
  "nodes",
  "edges",
] as const;

function validateGraph(
  value: unknown,
  path: string,
  p: Problems,
  depth: number,
  seenNodeIds: Set<string>,
): void {
  if (depth > MAX_NESTING_DEPTH) {
    p.err(path, `nested deeper than the ${MAX_NESTING_DEPTH}-level limit`);
    return;
  }
  if (!isRecord(value)) {
    p.err(path, `expected an object, got ${describe(value)}`);
    return;
  }

  checkUnknownKeys(value, GRAPH_KEYS, path, p);
  requireString(value, "id", path, p, { allowEmpty: false });
  requireString(value, "name", path, p);
  checkTimestamp(value, "createdAt", path, p);
  checkTimestamp(value, "updatedAt", path, p);
  validateViewport(value["viewport"], `${path}.viewport`, p);

  const nodes = value["nodes"];
  const localNodeIds = new Set<string>();
  if (!Array.isArray(nodes)) {
    p.err(`${path}.nodes`, `expected an array, got ${describe(nodes)}`);
  } else {
    nodes.forEach((node, i) => {
      validateNode(node, `${path}.nodes[${i}]`, p, depth, seenNodeIds);
      const id = isRecord(node) ? node["id"] : undefined;
      if (typeof id === "string") {
        if (localNodeIds.has(id)) {
          p.err(`${path}.nodes[${i}].id`, `duplicate node id "${id}" within this graph`);
        }
        localNodeIds.add(id);
      }
    });
  }

  const edges = value["edges"];
  if (!Array.isArray(edges)) {
    p.err(`${path}.edges`, `expected an array, got ${describe(edges)}`);
    return;
  }

  const localEdgeIds = new Set<string>();
  edges.forEach((edge, i) => {
    const edgePath = `${path}.edges[${i}]`;
    validateEdge(edge, edgePath, p);
    if (!isRecord(edge)) return;

    const id = edge["id"];
    if (typeof id === "string") {
      if (localEdgeIds.has(id)) {
        p.err(`${edgePath}.id`, `duplicate edge id "${id}" within this graph`);
      }
      localEdgeIds.add(id);
    }

    // Referential integrity: an edge pointing at a node that is not in the
    // same graph would render as a dangling connection.
    for (const end of ["source", "target"] as const) {
      const ref = edge[end];
      if (typeof ref === "string" && !localNodeIds.has(ref)) {
        p.err(`${edgePath}.${end}`, `refers to node "${ref}", which is not in this graph`);
      }
    }
  });
}

/**
 * Validates an already-parsed value as a current-version `GraphFile`.
 * Exported for tests and for anything that receives a graph object without
 * going through JSON (e.g. clipboard paste).
 */
export function validateGraphFile(value: unknown): ParseResult {
  const p = new Problems();

  if (!isRecord(value)) {
    p.err("<root>", `expected an object, got ${describe(value)}`);
    return { ok: false, errors: p.errors, warnings: p.warnings };
  }

  checkUnknownKeys(value, ["formatVersion", "app", "graph"], "<root>", p);

  if (value["app"] !== APP_NAME) {
    p.err("<root>.app", `expected "${APP_NAME}", got ${describe(value["app"])} — is this a MindGraph file?`);
  }

  const version = value["formatVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    p.err("<root>.formatVersion", `expected a positive integer, got ${describe(version)}`);
  } else if (version > FORMAT_VERSION) {
    p.err(
      "<root>.formatVersion",
      `this document uses format v${version}, but this build of MindGraph only understands up to v${FORMAT_VERSION} — please update MindGraph`,
    );
  }

  // Stop before validating the body: version and identity problems make every
  // downstream complaint noise.
  if (p.errors.length > 0) {
    return { ok: false, errors: p.errors, warnings: p.warnings };
  }

  const migrated = migrate(value, version as number, p);
  if (p.errors.length > 0) {
    return { ok: false, errors: p.errors, warnings: p.warnings };
  }

  validateGraph(migrated["graph"], "<root>.graph", p, 0, new Set<string>());

  if (p.errors.length > 0) {
    return { ok: false, errors: p.errors, warnings: p.warnings };
  }

  // Every field has been checked above, so the cast is sound. `formatVersion`
  // is normalised to current: the body has been migrated to match.
  const file = { ...migrated, formatVersion: FORMAT_VERSION } as unknown as GraphFile;
  return { ok: true, file, warnings: p.warnings };
}

/**
 * Parses the text of a `.mindgraph` file. Never throws — inspect `ok`.
 */
export function deserialize(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`<root>: not valid JSON — ${message}`], warnings: [] };
  }
  return validateGraphFile(parsed);
}

// Re-exported so callers need only import from this module.
export type { Edge, Graph, GraphFile, Node, Viewport };
