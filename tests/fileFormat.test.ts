import { describe, expect, it } from "vitest";

import { APP_NAME, FORMAT_VERSION, type Graph, type GraphFile } from "../src/types/graph.js";
import {
  createCompoundNode,
  createEdge,
  createGraph,
  createGraphFile,
  createIdeaNode,
} from "../src/utils/factories.js";
import {
  MAX_NESTING_DEPTH,
  type ParseResult,
  type ParseSuccess,
  deserialize,
  serialize,
  serializeFile,
  validateGraphFile,
} from "../src/utils/fileFormat.js";

/** A graph exercising every optional field, with two levels of nesting. */
function sampleGraph(): Graph {
  const root = createGraph({ name: "Product ideas" });

  const a = createIdeaNode({
    title: "Pricing",
    position: { x: 10, y: 20 },
    description: "# Notes\n\nSome *markdown* here.",
  });
  a.data.tags = ["revenue", "q3"];
  a.data.color = "#ff8800";

  const inner = createGraph({ name: "Onboarding detail" });
  const i1 = createIdeaNode({ title: "Welcome email", position: { x: 0, y: 0 } });
  const i2 = createIdeaNode({ title: "Sample project", position: { x: 120, y: 40 } });
  inner.nodes = [i1, i2];
  inner.edges = [createEdge({ source: i1.id, target: i2.id, label: "then", style: "dashed" })];

  const b = createCompoundNode({
    title: "Onboarding",
    position: { x: 300, y: 60 },
    subgraph: inner,
  });

  root.nodes = [a, b];
  root.edges = [createEdge({ source: a.id, target: b.id })];
  root.viewport = { x: -40, y: 15, zoom: 0.75 };
  return root;
}

/** Deep-clones a valid file so a test can corrupt one field in isolation. */
function validFile(): GraphFile {
  return JSON.parse(JSON.stringify(createGraphFile(sampleGraph()))) as GraphFile;
}

function expectOk(result: ParseResult): ParseSuccess {
  if (!result.ok) {
    throw new Error(`expected a valid document, got errors:\n${result.errors.join("\n")}`);
  }
  return result;
}

/** Asserts the document was rejected and hands back the reasons. */
function expectErrors(result: ParseResult): string[] {
  if (result.ok) {
    throw new Error("expected the document to be rejected, but it validated");
  }
  return result.errors;
}

describe("serialize", () => {
  it("round-trips a graph through JSON without losing anything", () => {
    const graph = sampleGraph();
    const result = expectOk(deserialize(serialize(graph)));
    expect(result.file.graph).toEqual(graph);
    expect(result.warnings).toEqual([]);
  });

  it("preserves nested sub-graphs at depth", () => {
    let graph = createGraph({ name: "level-5" });
    for (let level = 4; level >= 0; level--) {
      const parent = createGraph({ name: `level-${level}` });
      parent.nodes = [createCompoundNode({ title: `group ${level}`, subgraph: graph })];
      graph = parent;
    }

    const result = expectOk(deserialize(serialize(graph)));
    expect(result.file.graph).toEqual(graph);

    let cursor = result.file.graph;
    for (let level = 0; level < 5; level++) {
      expect(cursor.name).toBe(`level-${level}`);
      cursor = cursor.nodes[0]!.data.subgraph!;
    }
    expect(cursor.name).toBe("level-5");
  });

  it("writes a current-version envelope", () => {
    const parsed = JSON.parse(serialize(sampleGraph())) as GraphFile;
    expect(parsed.app).toBe(APP_NAME);
    expect(parsed.formatVersion).toBe(FORMAT_VERSION);
  });

  it("writes human-readable, diffable JSON", () => {
    const text = serialize(sampleGraph());
    expect(text).toContain('\n  "graph": {');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is deterministic for identical input", () => {
    const graph = sampleGraph();
    expect(serialize(graph)).toBe(serialize(graph));
  });
});

describe("deserialize — rejecting damaged files", () => {
  it("reports malformed JSON without throwing", () => {
    const errors = expectErrors(deserialize("{ not json"));
    expect(errors[0]).toContain("not valid JSON");
  });

  it("rejects a file that is not a MindGraph document", () => {
    const errors = expectErrors(deserialize(JSON.stringify({ formatVersion: 1, app: "SomethingElse", graph: {} })));
    expect(errors.join()).toContain("is this a MindGraph file?");
  });

  it("refuses a document from a newer version of the app", () => {
    const file = validFile();
    (file as { formatVersion: number }).formatVersion = FORMAT_VERSION + 1;
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("please update MindGraph");
  });

  it.each([
    ["a non-object root", 42],
    ["null", null],
    ["an array", []],
  ])("rejects %s", (_label, value) => {
    expect(validateGraphFile(value).ok).toBe(false);
  });

  it("rejects a node missing its title", () => {
    const file = validFile();
    delete (file.graph.nodes[0]!.data as { title?: string }).title;
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("<root>.graph.nodes[0].data.title");
  });

  it("rejects a non-finite position", () => {
    const file = validFile();
    (file.graph.nodes[0]!.position as { x: unknown }).x = "12";
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("nodes[0].position.x");
  });

  it("rejects an unknown node type", () => {
    const file = validFile();
    (file.graph.nodes[0] as { type: string }).type = "sticky";
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("idea | compound");
  });

  it("rejects a compound node with no sub-graph", () => {
    const file = validFile();
    delete file.graph.nodes[1]!.data.subgraph;
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain('required when type is "compound"');
  });

  it("rejects an idea node carrying a sub-graph", () => {
    const file = validFile();
    file.graph.nodes[0]!.data.subgraph = createGraph({ name: "stowaway" });
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain('only allowed when type is "compound"');
  });

  it("rejects an edge pointing at a node that is not in the graph", () => {
    const file = validFile();
    file.graph.edges[0]!.target = "does-not-exist";
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain('refers to node "does-not-exist"');
  });

  it("rejects an edge that reaches into a sub-graph", () => {
    const file = validFile();
    const innerNodeId = file.graph.nodes[1]!.data.subgraph!.nodes[0]!.id;
    file.graph.edges[0]!.target = innerNodeId;
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("which is not in this graph");
  });

  it("rejects duplicate node ids within one graph", () => {
    const file = validFile();
    file.graph.nodes[1]!.id = file.graph.nodes[0]!.id;
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("duplicate node id");
  });

  it("rejects an invalid edge style", () => {
    const file = validFile();
    (file.graph.edges[0] as { style: string }).style = "squiggly";
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("solid | dashed");
  });

  it("rejects a zero or negative zoom", () => {
    const file = validFile();
    file.graph.viewport.zoom = 0;
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.join()).toContain("greater than 0");
  });

  it("reports every problem at once, not just the first", () => {
    const file = validFile();
    delete (file.graph.nodes[0]!.data as { title?: string }).title;
    (file.graph.nodes[0]!.position as { x: unknown }).x = null;
    file.graph.edges[0]!.source = "nope";
    const errors = expectErrors(validateGraphFile(file));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("stops runaway nesting instead of overflowing the stack", () => {
    let graph = createGraph({ name: "bottom" });
    for (let i = 0; i < MAX_NESTING_DEPTH + 5; i++) {
      const parent = createGraph({ name: `level-${i}` });
      parent.nodes = [createCompoundNode({ title: "deep", subgraph: graph })];
      graph = parent;
    }
    const errors = expectErrors(validateGraphFile(createGraphFile(graph)));
    expect(errors.join()).toContain("nested deeper than");
  });
});

describe("deserialize — tolerating harmless oddities", () => {
  it("keeps unknown fields and warns rather than failing", () => {
    const file = validFile() as unknown as Record<string, unknown>;
    (file["graph"] as Record<string, unknown>)["futureField"] = { anything: true };
    const result = expectOk(validateGraphFile(file));
    expect(result.warnings.join()).toContain("unknown field");
    expect((result.file.graph as unknown as Record<string, unknown>)["futureField"]).toEqual({
      anything: true,
    });
  });

  it("warns about an unparseable timestamp but still opens the file", () => {
    const file = validFile();
    file.graph.updatedAt = "last Tuesday";
    const result = expectOk(validateGraphFile(file));
    expect(result.warnings.join()).toContain("not a parseable date");
  });

  it("warns when a node id is reused across sub-graphs", () => {
    const file = validFile();
    const reused = file.graph.nodes[0]!.id;
    const inner = file.graph.nodes[1]!.data.subgraph!;
    const original = inner.nodes[0]!.id;
    // Re-point the sub-graph's own edge too, so the only anomaly under test is
    // the collision itself rather than a dangling reference.
    inner.nodes[0]!.id = reused;
    for (const edge of inner.edges) {
      if (edge.source === original) edge.source = reused;
      if (edge.target === original) edge.target = reused;
    }

    const result = expectOk(validateGraphFile(file));
    expect(result.warnings.join()).toContain("also used elsewhere");
  });
});

describe("factories", () => {
  it("produce documents that pass validation", () => {
    expectOk(validateGraphFile(createGraphFile()));
    expectOk(validateGraphFile(createGraphFile(sampleGraph())));
  });

  it("give a compound node a sub-graph by default", () => {
    const node = createCompoundNode({ title: "Group" });
    expect(node.data.subgraph).toBeDefined();
    expect(node.data.subgraph!.nodes).toEqual([]);
  });

  it("omit optional fields entirely rather than writing nulls", () => {
    const text = serializeFile(createGraphFile());
    expect(text).not.toContain("null");
  });

  it("generate distinct ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createIdeaNode({}).id));
    expect(ids.size).toBe(500);
  });
});
