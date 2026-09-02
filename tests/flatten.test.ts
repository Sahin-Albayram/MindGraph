import { describe, expect, it } from "vitest";

import {
  GROUP_HEADER,
  GROUP_PADDING,
  containerBoxes,
  flatten,
  footprintOf,
  parseRef,
  refKey,
  sizeFor,
} from "../src/components/flatten.js";
import {
  createCompoundNode,
  createEdge,
  createGraph,
  createIdeaNode,
} from "../src/utils/factories.js";
import type { Graph } from "../src/types/graph.js";

/** Root holding one group, itself holding two connected ideas. */
function document(): { root: Graph; groupId: string; innerIds: [string, string] } {
  const inner = createGraph({ name: "Inside" });
  const a = createIdeaNode({ title: "Inner A", position: { x: 20, y: 30 } });
  const b = createIdeaNode({ title: "Inner B", position: { x: 200, y: 140 } });
  inner.nodes = [a, b];
  inner.edges = [createEdge({ source: a.id, target: b.id })];

  const group = createCompoundNode({ title: "Group", position: { x: 400, y: 50 }, subgraph: inner });
  const outside = createIdeaNode({ title: "Outside", position: { x: 0, y: 0 } });

  const root = createGraph({ name: "Root" });
  root.nodes = [outside, group];
  root.edges = [createEdge({ source: outside.id, target: group.id })];

  return { root, groupId: group.id, innerIds: [a.id, b.id] };
}

describe("element references", () => {
  it("round-trips a path and id", () => {
    const key = refKey(["a", "b"], "c");
    expect(parseRef(key)).toEqual({ path: ["a", "b"], id: "c" });
  });

  it("treats a top-level node as having an empty path", () => {
    expect(parseRef(refKey([], "solo"))).toEqual({ path: [], id: "solo" });
  });
});

describe("flatten", () => {
  it("leaves a collapsed group's contents out entirely", () => {
    const { root } = document();
    const flat = flatten(root, [], new Set());

    expect(flat.nodes).toHaveLength(2);
    expect(flat.nodes.every((node) => node.parentId === undefined)).toBe(true);
    expect(flat.edges).toHaveLength(1);
  });

  it("emits an expanded group's children as its React Flow children", () => {
    const { root, groupId, innerIds } = document();
    const flat = flatten(root, [], new Set([refKey([], groupId)]));

    expect(flat.nodes).toHaveLength(4);

    const children = flat.nodes.filter((node) => node.parentId !== undefined);
    expect(children.map((node) => node.id)).toEqual([
      refKey([groupId], innerIds[0]),
      refKey([groupId], innerIds[1]),
    ]);
    // Deliberately *not* `extent: "parent"`: dragging a child out of its
    // container is how it moves to another graph, so it must not be penned in.
    expect(children.every((node) => node.extent === undefined)).toBe(true);
  });

  it("offsets children clear of the container's header", () => {
    const { root, groupId, innerIds } = document();
    const flat = flatten(root, [], new Set([refKey([], groupId)]));

    const child = flat.nodes.find((node) => node.id === refKey([groupId], innerIds[0]))!;
    expect(child.position).toEqual({ x: 20 + GROUP_PADDING, y: 30 + GROUP_HEADER });
  });

  it("keeps the container's own position in its parent's coordinates", () => {
    const { root, groupId } = document();
    const flat = flatten(root, [], new Set([refKey([], groupId)]));

    const group = flat.nodes.find((node) => node.id === refKey([], groupId))!;
    expect(group.position).toEqual({ x: 400, y: 50 });
  });

  it("sizes a container to hold its furthest child", () => {
    const { root, groupId } = document();
    const flat = flatten(root, [], new Set([refKey([], groupId)]));

    const group = flat.nodes.find((node) => node.id === refKey([], groupId))!;
    const style = group.style as { width: number; height: number };
    expect(style.width).toBeGreaterThan(200);
    expect(style.height).toBeGreaterThan(140 + GROUP_HEADER);
  });

  it("tells the group renderer that it is open", () => {
    const { root, groupId } = document();

    const collapsed = flatten(root, [], new Set());
    expect(collapsed.nodes.find((n) => n.id === refKey([], groupId))!.data["expanded"]).toBe(false);

    const open = flatten(root, [], new Set([refKey([], groupId)]));
    expect(open.nodes.find((n) => n.id === refKey([], groupId))!.data["expanded"]).toBe(true);
  });

  it("keys every edge by the graph that owns it", () => {
    const { root, groupId, innerIds } = document();
    const flat = flatten(root, [], new Set([refKey([], groupId)]));

    expect(flat.edges).toHaveLength(2);
    const innerEdge = flat.edges.find((edge) => edge.source === refKey([groupId], innerIds[0]))!;
    expect(innerEdge.target).toBe(refKey([groupId], innerIds[1]));
  });

  it("expands groups nested inside expanded groups", () => {
    const deepest = createGraph({ name: "Deepest" });
    deepest.nodes = [createIdeaNode({ title: "Bottom", position: { x: 0, y: 0 } })];

    const middleInner = createGraph({ name: "Middle" });
    const innerGroup = createCompoundNode({
      title: "Inner group",
      position: { x: 10, y: 10 },
      subgraph: deepest,
    });
    middleInner.nodes = [innerGroup];

    const outerGroup = createCompoundNode({
      title: "Outer",
      position: { x: 0, y: 0 },
      subgraph: middleInner,
    });
    const root = createGraph({ name: "Root" });
    root.nodes = [outerGroup];

    const expanded = new Set([
      refKey([], outerGroup.id),
      refKey([outerGroup.id], innerGroup.id),
    ]);
    const flat = flatten(root, [], expanded);

    expect(flat.nodes.map((node) => node.id)).toContain(
      refKey([outerGroup.id, innerGroup.id], deepest.nodes[0]!.id),
    );
  });

  it("grows a container to fit an expanded group inside it", () => {
    // The bug this guards: a nested open group was measured as though it were
    // an ordinary card, so it overflowed the container drawn around it.
    const deepest = createGraph({ name: "Deepest" });
    deepest.nodes = [
      createIdeaNode({ title: "Far", position: { x: 320, y: 260 } }),
    ];

    const middle = createGraph({ name: "Middle" });
    const innerGroup = createCompoundNode({
      title: "Inner",
      position: { x: 30, y: 20 },
      subgraph: deepest,
    });
    middle.nodes = [innerGroup];

    const outerGroup = createCompoundNode({
      title: "Outer",
      position: { x: 0, y: 0 },
      subgraph: middle,
    });
    const root = createGraph({ name: "Root" });
    root.nodes = [outerGroup];

    const outerKey = refKey([], outerGroup.id);
    const innerKey = refKey([outerGroup.id], innerGroup.id);

    const collapsedInner = sizeFor(middle, [outerGroup.id], new Set([outerKey]));
    const expandedInner = sizeFor(middle, [outerGroup.id], new Set([outerKey, innerKey]));

    expect(expandedInner.width).toBeGreaterThan(collapsedInner.width);
    expect(expandedInner.height).toBeGreaterThan(collapsedInner.height);

    // The outer container must be wide enough for the inner one drawn at its
    // own offset, plus padding.
    const inner = sizeFor(deepest, [outerGroup.id, innerGroup.id], new Set());
    expect(expandedInner.width).toBeGreaterThanOrEqual(30 + inner.width + GROUP_PADDING);
  });

  it("measures a collapsed group as an ordinary card", () => {
    const inner = createGraph({ name: "Inner" });
    inner.nodes = [createIdeaNode({ title: "Deep", position: { x: 900, y: 900 } })];
    const group = createCompoundNode({ title: "G", position: { x: 0, y: 0 }, subgraph: inner });

    const closed = footprintOf(group, [], new Set());
    const open = footprintOf(group, [], new Set([refKey([], group.id)]));

    expect(closed.width).toBeLessThan(open.width);
    expect(closed.height).toBeLessThan(open.height);
  });

  it("reports container boxes innermost last, so the deepest drop wins", () => {
    const deepest = createGraph({ name: "Deepest" });
    const middle = createGraph({ name: "Middle" });
    const innerGroup = createCompoundNode({
      title: "Inner",
      position: { x: 40, y: 40 },
      subgraph: deepest,
    });
    middle.nodes = [innerGroup];
    const outerGroup = createCompoundNode({
      title: "Outer",
      position: { x: 100, y: 100 },
      subgraph: middle,
    });
    const root = createGraph({ name: "Root" });
    root.nodes = [outerGroup];

    const expanded = new Set([
      refKey([], outerGroup.id),
      refKey([outerGroup.id], innerGroup.id),
    ]);
    const boxes = containerBoxes(root, [], expanded);

    expect(boxes.map((box) => box.depth)).toEqual([0, 1]);
    // The inner box is offset by the outer's padding and header.
    expect(boxes[1]!.x).toBe(100 + GROUP_PADDING + 40);
    expect(boxes[1]!.y).toBe(100 + GROUP_HEADER + 40);
  });

  it("keys against the graph on screen when viewing a sub-graph", () => {
    const { root, groupId, innerIds } = document();
    const inner = root.nodes.find((node) => node.id === groupId)!.data.subgraph!;

    // Focused on the group: its children are now top-level, but their keys
    // still carry the full path from the root.
    const flat = flatten(inner, [groupId], new Set());
    expect(flat.nodes.map((node) => node.id)).toEqual([
      refKey([groupId], innerIds[0]),
      refKey([groupId], innerIds[1]),
    ]);
  });
});
