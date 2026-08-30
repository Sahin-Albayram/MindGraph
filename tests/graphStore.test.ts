import { beforeEach, describe, expect, it } from "vitest";

import type { Graph } from "../src/types/graph.js";
import { useGraphStore } from "../src/store/graphStore.js";
import {
  selectBreadcrumbs,
  selectCanRedo,
  selectCanUndo,
  selectCurrentGraph,
  selectIsDirty,
} from "../src/store/selectors.js";
import { createCompoundNode, createGraph, createIdeaNode } from "../src/utils/factories.js";
import { serialize, deserialize } from "../src/utils/fileFormat.js";

const store = useGraphStore;
const state = () => store.getState();

/** Adds an idea node to the graph on screen and returns its id. */
function addIdea(title: string, position = { x: 0, y: 0 }): string {
  const node = createIdeaNode({ title, position });
  state().addNode(node);
  return node.id;
}

beforeEach(() => {
  state().newDocument("Test document");
});

describe("document lifecycle", () => {
  it("starts clean, empty and at the root", () => {
    expect(selectCurrentGraph(state())).toBe(state().root);
    expect(state().root.nodes).toEqual([]);
    expect(state().path).toEqual([]);
    expect(selectIsDirty(state())).toBe(false);
    expect(state().filePath).toBeNull();
  });

  it("becomes dirty on an edit and clean again once saved", () => {
    addIdea("Something");
    expect(selectIsDirty(state())).toBe(true);

    state().markSaved("/tmp/test.mindgraph");
    expect(selectIsDirty(state())).toBe(false);
    expect(state().filePath).toBe("/tmp/test.mindgraph");
  });

  it("reports clean again after undoing back to the saved state", () => {
    addIdea("Saved idea");
    state().markSaved("/tmp/test.mindgraph");

    addIdea("Unsaved idea");
    expect(selectIsDirty(state())).toBe(true);

    state().undo();
    // History holds the very same object that was saved, so a reference
    // comparison is enough to know the document is unmodified again.
    expect(selectIsDirty(state())).toBe(false);
  });

  it("clears history when a document is loaded", () => {
    addIdea("From the old document");
    expect(selectCanUndo(state())).toBe(true);

    state().loadDocument(createGraph({ name: "Opened" }), "/tmp/opened.mindgraph");
    expect(selectCanUndo(state())).toBe(false);
    expect(selectIsDirty(state())).toBe(false);
    expect(state().root.name).toBe("Opened");
  });
});

describe("editing the graph on screen", () => {
  it("adds, updates and removes nodes", () => {
    const id = addIdea("Draft");
    expect(selectCurrentGraph(state()).nodes).toHaveLength(1);

    state().updateNodeData(id, { title: "Final", description: "# Notes" });
    const node = selectCurrentGraph(state()).nodes[0]!;
    expect(node.data.title).toBe("Final");
    expect(node.data.description).toBe("# Notes");

    state().removeNode(id);
    expect(selectCurrentGraph(state()).nodes).toEqual([]);
  });

  it("connects two nodes with a directed edge", () => {
    const a = addIdea("A");
    const b = addIdea("B");
    state().connect(a, b, { label: "leads to", style: "dashed" });

    const [edge] = selectCurrentGraph(state()).edges;
    expect(edge).toMatchObject({ source: a, target: b, label: "leads to", style: "dashed" });
  });

  it("refuses an edge to a node that is not in this graph", () => {
    const a = addIdea("A");
    state().connect(a, "not-here");
    expect(selectCurrentGraph(state()).edges).toEqual([]);
  });

  it("refuses a duplicate edge in the same direction but allows the reverse", () => {
    const a = addIdea("A");
    const b = addIdea("B");
    state().connect(a, b);
    state().connect(a, b);
    expect(selectCurrentGraph(state()).edges).toHaveLength(1);

    state().connect(b, a);
    expect(selectCurrentGraph(state()).edges).toHaveLength(2);
  });

  it("removes edges attached to a deleted node, so none dangle", () => {
    const a = addIdea("A");
    const b = addIdea("B");
    const c = addIdea("C");
    state().connect(a, b);
    state().connect(b, c);
    expect(selectCurrentGraph(state()).edges).toHaveLength(2);

    state().removeNode(b);
    expect(selectCurrentGraph(state()).edges).toEqual([]);

    // The result must still be a legal document.
    const parsed = deserialize(serialize(state().root));
    expect(parsed.ok).toBe(true);
  });

  it("stamps updatedAt on the edited graph and the root", () => {
    const before = state().root.updatedAt;
    addIdea("Anything");
    expect(state().root.updatedAt >= before).toBe(true);
  });

  it("ignores edits aimed at nodes that do not exist", () => {
    const rootBefore = state().root;
    state().updateNodeData("ghost", { title: "x" });
    state().removeNode("ghost");
    state().removeEdge("ghost");
    expect(state().root).toBe(rootBefore);
    expect(selectCanUndo(state())).toBe(false);
  });
});

describe("nested sub-graph navigation", () => {
  /** Root with one compound node, returning that node's id. */
  function withCompound(): string {
    const node = createCompoundNode({ title: "Group", position: { x: 0, y: 0 } });
    state().addNode(node);
    return node.id;
  }

  it("enters and leaves a sub-graph", () => {
    const groupId = withCompound();
    state().enterSubgraph(groupId);
    expect(state().path).toEqual([groupId]);
    expect(selectCurrentGraph(state()).name).toBe("Group");

    state().exitSubgraph();
    expect(state().path).toEqual([]);
  });

  it("refuses to enter a node that has no sub-graph", () => {
    const id = addIdea("Plain");
    state().enterSubgraph(id);
    expect(state().path).toEqual([]);
  });

  it("edits inside a sub-graph without touching the parent", () => {
    const groupId = withCompound();
    state().enterSubgraph(groupId);
    addIdea("Inner");

    expect(selectCurrentGraph(state()).nodes).toHaveLength(1);
    // The parent still has only the compound node itself.
    expect(state().root.nodes).toHaveLength(1);
    expect(state().root.nodes[0]!.data.subgraph!.nodes).toHaveLength(1);
  });

  it("keeps sibling sub-graphs independent", () => {
    const first = withCompound();
    const second = withCompound();

    state().enterSubgraph(first);
    addIdea("Only in first");
    state().navigateTo(0);
    state().enterSubgraph(second);

    expect(selectCurrentGraph(state()).nodes).toEqual([]);
  });

  it("builds a breadcrumb trail down to the current graph", () => {
    const groupId = withCompound();
    state().enterSubgraph(groupId);

    const inner = createCompoundNode({ title: "Inner group", position: { x: 0, y: 0 } });
    state().addNode(inner);
    state().enterSubgraph(inner.id);

    expect(selectBreadcrumbs(state()).map((crumb) => crumb.label)).toEqual([
      "Test document",
      "Group",
      "Inner group",
    ]);
  });

  it("navigates to a breadcrumb by depth and ignores out-of-range depths", () => {
    const groupId = withCompound();
    state().enterSubgraph(groupId);

    state().navigateTo(5);
    expect(state().path).toEqual([groupId]);

    state().navigateTo(0);
    expect(state().path).toEqual([]);
  });

  it("marks an existing node compound so it can be entered", () => {
    const id = addIdea("Becomes a group");
    state().convertToCompound(id);

    const node = selectCurrentGraph(state()).nodes[0]!;
    expect(node.type).toBe("compound");
    expect(node.data.subgraph).toBeDefined();

    state().enterSubgraph(id);
    expect(state().path).toEqual([id]);
  });
});

describe("undo and redo", () => {
  it("reverses and replays an edit", () => {
    addIdea("First");
    expect(selectCanUndo(state())).toBe(true);

    state().undo();
    expect(selectCurrentGraph(state()).nodes).toEqual([]);
    expect(selectCanRedo(state())).toBe(true);

    state().redo();
    expect(selectCurrentGraph(state()).nodes).toHaveLength(1);
  });

  it("does nothing at either end of the history", () => {
    const start = state().root;
    state().undo();
    expect(state().root).toBe(start);

    addIdea("One");
    const after = state().root;
    state().redo();
    expect(state().root).toBe(after);
  });

  it("drops the redo stack once a new edit is made", () => {
    addIdea("First");
    state().undo();
    expect(selectCanRedo(state())).toBe(true);

    addIdea("Divergent");
    expect(selectCanRedo(state())).toBe(false);
  });

  it("undoes inside a sub-graph without leaving it", () => {
    const group = createCompoundNode({ title: "Group", position: { x: 0, y: 0 } });
    state().addNode(group);
    state().enterSubgraph(group.id);
    addIdea("Inner");

    state().undo();
    expect(state().path).toEqual([group.id]);
    expect(selectCurrentGraph(state()).nodes).toEqual([]);
  });

  it("retreats to a valid graph when undo removes the one being viewed", () => {
    const group = createCompoundNode({ title: "Group", position: { x: 0, y: 0 } });
    state().addNode(group);
    state().enterSubgraph(group.id);
    expect(state().path).toEqual([group.id]);

    // Undo the *creation* of the compound node the view is inside.
    state().undo();
    expect(state().path).toEqual([]);
    expect(selectCurrentGraph(state())).toBe(state().root);
  });

  it("collapses one drag gesture into a single history entry", () => {
    const id = addIdea("Draggable");
    const historyBefore = state().past.length;

    for (let x = 1; x <= 20; x++) {
      state().moveNode(id, { x, y: 0 }, { coalesce: true });
    }
    state().endGesture();

    expect(state().past.length).toBe(historyBefore + 1);
    expect(selectCurrentGraph(state()).nodes[0]!.position).toEqual({ x: 20, y: 0 });

    state().undo();
    expect(selectCurrentGraph(state()).nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it("keeps separate drags separately undoable", () => {
    const id = addIdea("Draggable");

    state().moveNode(id, { x: 10, y: 0 }, { coalesce: true });
    state().endGesture();
    state().moveNode(id, { x: 20, y: 0 }, { coalesce: true });
    state().endGesture();

    state().undo();
    expect(selectCurrentGraph(state()).nodes[0]!.position).toEqual({ x: 10, y: 0 });
  });

  it("records a move made without coalescing as its own entry", () => {
    const id = addIdea("Node");
    const before = state().past.length;
    state().moveNode(id, { x: 5, y: 5 });
    expect(state().past.length).toBe(before + 1);
  });
});

describe("changes that must not enter history", () => {
  it("ignores viewport changes", () => {
    addIdea("Node");
    const historyBefore = state().past.length;

    state().setViewport({ x: 100, y: 50, zoom: 2 });
    expect(selectCurrentGraph(state()).viewport).toEqual({ x: 100, y: 50, zoom: 2 });
    expect(state().past.length).toBe(historyBefore);
  });

  it("ignores navigation", () => {
    const group = createCompoundNode({ title: "Group", position: { x: 0, y: 0 } });
    state().addNode(group);
    const historyBefore = state().past.length;

    state().enterSubgraph(group.id);
    state().exitSubgraph();
    expect(state().past.length).toBe(historyBefore);
  });

  it("keeps the viewport per sub-graph", () => {
    const group = createCompoundNode({ title: "Group", position: { x: 0, y: 0 } });
    state().addNode(group);
    state().setViewport({ x: 10, y: 10, zoom: 1.5 });

    state().enterSubgraph(group.id);
    expect(selectCurrentGraph(state()).viewport).toEqual({ x: 0, y: 0, zoom: 1 });

    state().exitSubgraph();
    expect(selectCurrentGraph(state()).viewport).toEqual({ x: 10, y: 10, zoom: 1.5 });
  });
});

describe("the store's output is always a valid document", () => {
  it("round-trips a nested document built entirely through actions", () => {
    const a = addIdea("Root idea", { x: 10, y: 20 });
    const group = createCompoundNode({ title: "Group", position: { x: 200, y: 0 } });
    state().addNode(group);
    state().connect(a, group.id, { label: "expands into" });

    state().enterSubgraph(group.id);
    const inner1 = addIdea("Inner one");
    const inner2 = addIdea("Inner two", { x: 150, y: 0 });
    state().connect(inner1, inner2);
    state().setViewport({ x: -20, y: 5, zoom: 0.8 });

    const text = serialize(state().root);
    const parsed = deserialize(text);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));

    expect(parsed.file.graph).toEqual(state().root);
    expect(parsed.warnings).toEqual([]);
  });

  it("keeps history entries structurally shared rather than deep copies", () => {
    const group = createCompoundNode({ title: "Group", position: { x: 0, y: 0 } });
    state().addNode(group);
    const untouched: Graph = state().root.nodes[0]!.data.subgraph!;

    addIdea("Sibling at the root");

    // Editing the root must not rebuild the sub-graph it did not touch.
    expect(state().root.nodes[0]!.data.subgraph).toBe(untouched);
  });
});
