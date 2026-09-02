import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("refuses to connect a node to itself", () => {
    const a = addIdea("A");
    const rootBefore = state().root;
    state().connect(a, a);
    expect(selectCurrentGraph(state()).edges).toEqual([]);
    expect(state().root).toBe(rootBefore);
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

  it("deletes a node and its edges as one undoable transaction", () => {
    // React Flow reports the node and its edges through separate callbacks;
    // the canvas funnels both into deleteElements so one Delete press is one
    // undo press.
    const a = addIdea("A");
    const b = addIdea("B");
    const c = addIdea("C");
    state().connect(a, b);
    state().connect(b, c);

    const edgeIds = selectCurrentGraph(state()).edges.map((edge) => edge.id);
    const historyBefore = state().past.length;

    state().deleteElements({ nodeIds: [b], edgeIds });

    expect(selectCurrentGraph(state()).nodes.map((node) => node.data.title)).toEqual(["A", "C"]);
    expect(selectCurrentGraph(state()).edges).toEqual([]);
    expect(state().past.length).toBe(historyBefore + 1);

    state().undo();
    expect(selectCurrentGraph(state()).nodes).toHaveLength(3);
    expect(selectCurrentGraph(state()).edges).toHaveLength(2);
  });

  it("drops edges hanging off a deleted node even when not listed", () => {
    const a = addIdea("A");
    const b = addIdea("B");
    state().connect(a, b);

    state().deleteElements({ nodeIds: [b] });
    expect(selectCurrentGraph(state()).edges).toEqual([]);

    const parsed = deserialize(serialize(state().root));
    expect(parsed.ok).toBe(true);
  });

  it("ignores an empty delete", () => {
    addIdea("A");
    const rootBefore = state().root;
    state().deleteElements({});
    expect(state().root).toBe(rootBefore);
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

describe("editing node data from the detail panel", () => {
  it("collapses a burst of typing into one history entry", () => {
    const id = addIdea("");
    const historyBefore = state().past.length;

    for (const text of ["P", "Pr", "Pri", "Pric", "Prici", "Pricing"]) {
      state().updateNodeData(id, { title: text }, { coalesce: "title" });
    }
    state().endGesture();

    expect(state().past.length).toBe(historyBefore + 1);
    expect(selectCurrentGraph(state()).nodes[0]!.data.title).toBe("Pricing");

    state().undo();
    expect(selectCurrentGraph(state()).nodes[0]!.data.title).toBe("");
  });

  it("keeps separate bursts separately undoable", () => {
    const id = addIdea("A");

    state().updateNodeData(id, { title: "First" }, { coalesce: "title" });
    state().endGesture();
    state().updateNodeData(id, { title: "Second" }, { coalesce: "title" });
    state().endGesture();

    state().undo();
    expect(selectCurrentGraph(state()).nodes[0]!.data.title).toBe("First");
  });

  it("does not merge edits to different fields", () => {
    const id = addIdea("Title");
    const historyBefore = state().past.length;

    state().updateNodeData(id, { title: "Changed" }, { coalesce: "title" });
    state().updateNodeData(id, { description: "Notes" }, { coalesce: "description" });

    expect(state().past.length).toBe(historyBefore + 2);
  });

  it("removes a field rather than storing an empty value", () => {
    const id = addIdea("Node");
    state().updateNodeData(id, { description: "Some notes" });
    expect(selectCurrentGraph(state()).nodes[0]!.data.description).toBe("Some notes");

    state().updateNodeData(id, { description: undefined });
    expect("description" in selectCurrentGraph(state()).nodes[0]!.data).toBe(false);

    // The cleared field must not reappear as null in the saved file.
    expect(serialize(state().root)).not.toContain("description");
  });

  it("ignores a patch that sets the value already present", () => {
    const id = addIdea("Same");
    const rootBefore = state().root;
    state().updateNodeData(id, { title: "Same" });
    expect(state().root).toBe(rootBefore);
  });

  it("ignores clearing a field that is already absent", () => {
    const id = addIdea("No description");
    const rootBefore = state().root;
    state().updateNodeData(id, { description: undefined });
    expect(state().root).toBe(rootBefore);
  });

  it("keeps the document valid after panel edits", () => {
    const id = addIdea("Node");
    state().updateNodeData(id, { title: "# Heading", description: "**bold** text" });

    const parsed = deserialize(serialize(state().root));
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    expect(parsed.file.graph.nodes[0]!.data.description).toBe("**bold** text");
  });
});

describe("editing a connection", () => {
  function connected(): string {
    const a = addIdea("A");
    const b = addIdea("B");
    state().connect(a, b);
    return selectCurrentGraph(state()).edges[0]!.id;
  }

  it("sets and clears a label", () => {
    const edgeId = connected();

    state().updateEdge(edgeId, { label: "supports" });
    expect(selectCurrentGraph(state()).edges[0]!.label).toBe("supports");

    state().updateEdge(edgeId, { label: undefined });
    expect("label" in selectCurrentGraph(state()).edges[0]!).toBe(false);
    expect(serialize(state().root)).not.toContain("label");
  });

  it("collapses a burst of label typing into one history entry", () => {
    const edgeId = connected();
    const historyBefore = state().past.length;

    for (const text of ["s", "su", "sup", "supp", "supports"]) {
      state().updateEdge(edgeId, { label: text }, { coalesce: "label" });
    }
    state().endGesture();

    expect(state().past.length).toBe(historyBefore + 1);
    expect(selectCurrentGraph(state()).edges[0]!.label).toBe("supports");
  });

  it("toggles between solid and tentative", () => {
    const edgeId = connected();

    state().updateEdge(edgeId, { style: "dashed" });
    expect(selectCurrentGraph(state()).edges[0]!.style).toBe("dashed");

    // Solid is the absence of a style, not a stored value.
    state().updateEdge(edgeId, { style: undefined });
    expect("style" in selectCurrentGraph(state()).edges[0]!).toBe(false);
  });

  it("ignores an edit that changes nothing", () => {
    const edgeId = connected();
    state().updateEdge(edgeId, { label: "same" });
    const rootBefore = state().root;
    state().updateEdge(edgeId, { label: "same" });
    expect(state().root).toBe(rootBefore);
  });

  it("ignores an edit to an edge that does not exist", () => {
    connected();
    const rootBefore = state().root;
    state().updateEdge("ghost", { label: "x" });
    expect(state().root).toBe(rootBefore);
  });

  it("keeps the document valid after edge edits", () => {
    const edgeId = connected();
    state().updateEdge(edgeId, { label: "depends on", style: "dashed" });

    const parsed = deserialize(serialize(state().root));
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    expect(parsed.file.graph.edges[0]).toMatchObject({ label: "depends on", style: "dashed" });
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

describe("working several levels deep", () => {
  /** Enters a new group named `title`, returning its node id. */
  function enterNewGroup(title: string): string {
    const group = createCompoundNode({ title, position: { x: 0, y: 0 } });
    state().addNode(group);
    state().enterSubgraph(group.id);
    return group.id;
  }

  it("edits at three levels and round-trips the whole tree", () => {
    addIdea("Top level");
    enterNewGroup("Level one");
    addIdea("Inside one");
    enterNewGroup("Level two");
    const deepA = addIdea("Inside two");
    const deepB = addIdea("Also inside two", { x: 200, y: 0 });
    state().connect(deepA, deepB, { label: "then" });

    expect(state().path).toHaveLength(2);

    const parsed = deserialize(serialize(state().root));
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    expect(parsed.file.graph).toEqual(state().root);

    // Walk the reloaded document back down the same path.
    let cursor = parsed.file.graph;
    for (const nodeId of state().path) {
      cursor = cursor.nodes.find((node) => node.id === nodeId)!.data.subgraph!;
    }
    expect(cursor.nodes.map((node) => node.data.title)).toEqual([
      "Inside two",
      "Also inside two",
    ]);
    expect(cursor.edges[0]!.label).toBe("then");
  });

  it("returns to the parent graph without disturbing it", () => {
    const topId = addIdea("Top level");
    const groupId = enterNewGroup("Group");
    addIdea("Child");

    state().exitSubgraph();

    expect(state().path).toEqual([]);
    expect(selectCurrentGraph(state()).nodes.map((node) => node.id)).toEqual([topId, groupId]);
  });

  it("counts what a group holds, from outside it", () => {
    const groupId = enterNewGroup("Group");
    addIdea("One");
    addIdea("Two");
    state().navigateTo(0);

    const group = selectCurrentGraph(state()).nodes.find((node) => node.id === groupId)!;
    expect(group.data.subgraph!.nodes).toHaveLength(2);
  });

  it("deleting a group takes its whole subtree with it", () => {
    const groupId = enterNewGroup("Doomed");
    addIdea("Inside");
    state().navigateTo(0);

    state().deleteElements({ nodeIds: [groupId] });

    expect(selectCurrentGraph(state()).nodes).toEqual([]);
    const parsed = deserialize(serialize(state().root));
    expect(parsed.ok).toBe(true);
  });

  it("retreats to safety when the graph being viewed is deleted from above", () => {
    const groupId = enterNewGroup("Group");
    addIdea("Inside");
    state().navigateTo(0);
    state().enterSubgraph(groupId);
    expect(state().path).toEqual([groupId]);

    // Delete the group while its own contents are on screen.
    state().navigateTo(0);
    state().deleteElements({ nodeIds: [groupId] });
    expect(state().path).toEqual([]);
  });

  it("converts an idea into a group that can then be entered and filled", () => {
    const id = addIdea("Becomes a group");
    state().convertToCompound(id);
    state().enterSubgraph(id);
    addIdea("Now inside");

    expect(state().path).toEqual([id]);
    state().exitSubgraph();

    const converted = selectCurrentGraph(state()).nodes[0]!;
    expect(converted.type).toBe("compound");
    expect(converted.data.subgraph!.nodes.map((n) => n.data.title)).toEqual(["Now inside"]);

    const parsed = deserialize(serialize(state().root));
    expect(parsed.ok).toBe(true);
  });

  it("names a converted group after the idea it came from", () => {
    const id = addIdea("Distribution");
    state().convertToCompound(id);
    expect(selectCurrentGraph(state()).nodes[0]!.data.subgraph!.name).toBe("Distribution");
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

  it("ignores a move to the position the node already has", () => {
    const id = addIdea("Node", { x: 40, y: 180 });
    const rootBefore = state().root;
    const historyBefore = state().past.length;

    state().moveNode(id, { x: 40, y: 180 });
    expect(state().root).toBe(rootBefore);
    expect(state().past.length).toBe(historyBefore);
  });

  it("costs exactly one undo for a full React Flow drag sequence", () => {
    // React Flow emits a run of position changes with dragging: true, then a
    // final one at the *same* coordinates with dragging: false. Replaying that
    // shape here keeps the store honest about what a real drag costs.
    const id = addIdea("Draggable", { x: 0, y: 0 });
    const historyBefore = state().past.length;

    for (const x of [12, 40, 96, 160]) {
      state().moveNode(id, { x, y: 334 }, { coalesce: true });
    }
    state().moveNode(id, { x: 160, y: 334 }, { coalesce: false });
    state().endGesture();

    expect(state().past.length).toBe(historyBefore + 1);

    state().undo();
    expect(selectCurrentGraph(state()).nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it("records a move made without coalescing as its own entry", () => {
    const id = addIdea("Node");
    const before = state().past.length;
    state().moveNode(id, { x: 5, y: 5 });
    expect(state().past.length).toBe(before + 1);
  });
});

describe("no-op edits", () => {
  // These use fake timers deliberately. The store stamps `updatedAt` on every
  // real edit, and a stamp is itself a change — so if no-op detection ran after
  // stamping, a do-nothing edit would still be recorded. Within a single
  // millisecond the two timestamps are identical and the bug hides, which is
  // exactly how it escaped a first round of tests.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not record or stamp an edit that changes nothing, even later in time", () => {
    vi.useFakeTimers();
    const id = addIdea("Node", { x: 40, y: 180 });
    const rootBefore = state().root;
    const historyBefore = state().past.length;

    vi.setSystemTime(new Date(Date.now() + 5_000));

    state().moveNode(id, { x: 40, y: 180 });
    state().updateNodeData("does-not-exist", { title: "nothing" });
    state().removeNode("does-not-exist");
    state().connect(id, "does-not-exist");

    expect(state().root).toBe(rootBefore);
    expect(state().past.length).toBe(historyBefore);
  });

  it("still stamps updatedAt when an edit does change something", () => {
    vi.useFakeTimers();
    addIdea("First");
    const before = state().root.updatedAt;

    vi.setSystemTime(new Date(Date.now() + 5_000));
    addIdea("Second");

    expect(state().root.updatedAt > before).toBe(true);
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

  it("does not make a saved document look unsaved just by moving the camera", () => {
    addIdea("Node");
    state().markSaved("/tmp/doc.mindgraph");
    expect(selectIsDirty(state())).toBe(false);

    state().setViewport({ x: 120, y: 40, zoom: 1.5 });
    state().enterSubgraph("nope");

    // The camera is part of the document, but looking around is not editing.
    // A prompt the user learns to dismiss is worse than no prompt at all.
    expect(selectIsDirty(state())).toBe(false);
  });

  it("leaves an already-dirty document dirty when the camera moves", () => {
    addIdea("Node");
    expect(selectIsDirty(state())).toBe(true);

    state().setViewport({ x: 10, y: 10, zoom: 2 });
    expect(selectIsDirty(state())).toBe(true);
  });

  it("reports clean after undoing an edit made either side of a camera move", () => {
    addIdea("Saved");
    state().markSaved("/tmp/doc.mindgraph");

    state().setViewport({ x: 50, y: 50, zoom: 1.2 });
    addIdea("Unsaved");
    expect(selectIsDirty(state())).toBe(true);

    state().undo();
    expect(selectIsDirty(state())).toBe(false);
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
