import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  documentLabel,
  newDocument,
  openDocument,
  saveAndClose,
  saveDocument,
} from "../src/store/documentActions.js";
import { useGraphStore } from "../src/store/graphStore.js";
import { selectCurrentGraph, selectIsDirty } from "../src/store/selectors.js";
import type { DiscardChoice, OpenOutcome, SaveOutcome } from "../src/types/bridge.js";
import { createGraph, createIdeaNode } from "../src/utils/factories.js";
import { serialize } from "../src/utils/fileFormat.js";

const state = () => useGraphStore.getState();

/**
 * Stands in for the preload bridge. The real one only moves bytes and shows
 * native dialogs, so replacing it here exercises every decision the renderer
 * actually makes — the guards, the error paths, and what reaches disk.
 */
function stubBridge() {
  const bridge = {
    platform: "darwin" as NodeJS.Platform,
    versions: { app: "0.0.1", electron: "", chrome: "", node: "" },

    saveOutcome: { status: "ok", filePath: "/tmp/doc.mindgraph" } as SaveOutcome,
    openOutcome: { status: "cancelled" } as OpenOutcome,
    discardChoice: "discard" as DiscardChoice,

    saveCalls: [] as { filePath: string | null; contents: string; suggestedName: string }[],
    errors: [] as { title: string; detail: string }[],
    discardPrompts: 0,
    allowCloseCalls: 0,

    openDocument: vi.fn(async () => bridge.openOutcome),
    readDocument: vi.fn(async () => bridge.openOutcome),
    saveDocument: vi.fn(async (filePath: string | null, contents: string, suggestedName: string) => {
      bridge.saveCalls.push({ filePath, contents, suggestedName });
      return bridge.saveOutcome;
    }),
    confirmDiscard: vi.fn(async () => {
      bridge.discardPrompts += 1;
      return bridge.discardChoice;
    }),
    showError: vi.fn(async (title: string, detail: string) => {
      bridge.errors.push({ title, detail });
    }),
    setDocumentState: vi.fn(),
    onMenuCommand: vi.fn(() => () => undefined),
    allowClose: vi.fn(() => {
      bridge.allowCloseCalls += 1;
    }),
  };
  return bridge;
}

let bridge: ReturnType<typeof stubBridge>;

beforeEach(() => {
  bridge = stubBridge();
  (globalThis as { window?: unknown }).window = { mindgraph: bridge };
  state().newDocument("Test document");
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** Makes the document dirty. */
function edit(title = "An idea"): void {
  state().addNode(createIdeaNode({ title }));
}

describe("saving", () => {
  it("writes the serialized document and marks it clean", async () => {
    edit();
    expect(selectIsDirty(state())).toBe(true);

    const saved = await saveDocument();

    expect(saved).toBe(true);
    expect(bridge.saveCalls).toHaveLength(1);
    expect(bridge.saveCalls[0]!.contents).toBe(serialize(state().root));
    expect(selectIsDirty(state())).toBe(false);
    expect(state().filePath).toBe("/tmp/doc.mindgraph");
  });

  it("asks for a location when the document has never been saved", async () => {
    edit();
    await saveDocument();
    expect(bridge.saveCalls[0]!.filePath).toBeNull();
  });

  it("writes straight to the known path on a later save", async () => {
    edit();
    await saveDocument();
    edit("Another");
    await saveDocument();

    expect(bridge.saveCalls[1]!.filePath).toBe("/tmp/doc.mindgraph");
  });

  it("asks again for Save As, even with a known path", async () => {
    edit();
    await saveDocument();
    await saveDocument({ forceDialog: true });

    expect(bridge.saveCalls[1]!.filePath).toBeNull();
  });

  it("leaves the document dirty when the user cancels", async () => {
    edit();
    bridge.saveOutcome = { status: "cancelled" };

    expect(await saveDocument()).toBe(false);
    expect(selectIsDirty(state())).toBe(true);
    expect(state().filePath).toBeNull();
  });

  it("reports a write failure and does not claim the document is saved", async () => {
    edit();
    bridge.saveOutcome = { status: "error", message: "EACCES: permission denied" };

    expect(await saveDocument()).toBe(false);
    expect(selectIsDirty(state())).toBe(true);
    expect(bridge.errors[0]!.detail).toContain("EACCES");
  });
});

describe("guarding unsaved work", () => {
  it("does not prompt when there is nothing to lose", async () => {
    await newDocument();
    expect(bridge.discardPrompts).toBe(0);
  });

  it("abandons the operation when the user cancels", async () => {
    edit("Precious");
    bridge.discardChoice = "cancel";

    await newDocument();

    expect(bridge.discardPrompts).toBe(1);
    expect(selectCurrentGraph(state()).nodes).toHaveLength(1);
    expect(selectIsDirty(state())).toBe(true);
  });

  it("throws the work away only when the user says so", async () => {
    edit("Disposable");
    bridge.discardChoice = "discard";

    await newDocument();

    expect(selectCurrentGraph(state()).nodes).toEqual([]);
    expect(bridge.saveCalls).toHaveLength(0);
  });

  it("saves first when the user asks it to", async () => {
    edit("Worth keeping");
    bridge.discardChoice = "save";

    await newDocument();

    expect(bridge.saveCalls).toHaveLength(1);
    expect(selectCurrentGraph(state()).nodes).toEqual([]);
  });

  it("keeps the document when the save it was asked for fails", async () => {
    edit("Worth keeping");
    bridge.discardChoice = "save";
    bridge.saveOutcome = { status: "error", message: "disk full" };

    await newDocument();

    // The failed save must not be treated as permission to discard.
    expect(selectCurrentGraph(state()).nodes).toHaveLength(1);
  });

  it("guards Open as well as New", async () => {
    edit("Precious");
    bridge.discardChoice = "cancel";

    await openDocument();

    expect(bridge.discardPrompts).toBe(1);
    expect(bridge.openDocument).not.toHaveBeenCalled();
  });
});

describe("opening", () => {
  function fileWith(name: string): string {
    const graph = createGraph({ name });
    graph.nodes = [createIdeaNode({ title: "From disk", position: { x: 5, y: 6 } })];
    return serialize(graph);
  }

  it("replaces the document and adopts the file's path", async () => {
    bridge.openOutcome = {
      status: "ok",
      filePath: "/tmp/opened.mindgraph",
      contents: fileWith("Opened"),
    };

    await openDocument();

    expect(state().root.name).toBe("Opened");
    expect(selectCurrentGraph(state()).nodes[0]!.data.title).toBe("From disk");
    expect(state().filePath).toBe("/tmp/opened.mindgraph");
    expect(selectIsDirty(state())).toBe(false);
  });

  it("clears the undo history so the previous document cannot be undone into", async () => {
    edit("From the old document");
    bridge.discardChoice = "discard";
    bridge.openOutcome = {
      status: "ok",
      filePath: "/tmp/opened.mindgraph",
      contents: fileWith("Opened"),
    };

    await openDocument();

    expect(state().past).toEqual([]);
    expect(state().future).toEqual([]);
  });

  it("reports every problem in a damaged file and keeps the current document", async () => {
    const before = state().root;
    bridge.openOutcome = {
      status: "ok",
      filePath: "/tmp/broken.mindgraph",
      contents: '{"formatVersion":1,"app":"MindGraph","graph":{"id":"g","name":"x"}}',
    };

    await openDocument();

    expect(state().root).toBe(before);
    expect(bridge.errors[0]!.title).toBe("This file could not be opened");
    expect(bridge.errors[0]!.detail).toContain("<root>.graph");
  });

  it("refuses a file that is not JSON at all", async () => {
    const before = state().root;
    bridge.openOutcome = { status: "ok", filePath: "/tmp/notes.txt", contents: "hello" };

    await openDocument();

    expect(state().root).toBe(before);
    expect(bridge.errors[0]!.detail).toContain("not valid JSON");
  });

  it("opens a file with survivable oddities, and says what they were", async () => {
    const graph = createGraph({ name: "Slightly odd" });
    const parsed = JSON.parse(serialize(graph)) as Record<string, unknown>;
    (parsed["graph"] as Record<string, unknown>)["futureField"] = true;

    bridge.openOutcome = {
      status: "ok",
      filePath: "/tmp/odd.mindgraph",
      contents: JSON.stringify(parsed),
    };

    await openDocument();

    expect(state().root.name).toBe("Slightly odd");
    expect(bridge.errors[0]!.title).toBe("Opened with warnings");
    expect(bridge.errors[0]!.detail).toContain("unknown field");
  });

  it("reports a read failure", async () => {
    bridge.openOutcome = { status: "error", message: "ENOENT: no such file" };
    await openDocument();
    expect(bridge.errors[0]!.detail).toContain("ENOENT");
  });
});

describe("closing", () => {
  it("lets the window close once the save succeeds", async () => {
    edit();
    await saveAndClose();
    expect(bridge.allowCloseCalls).toBe(1);
  });

  it("keeps the window open when the save is cancelled", async () => {
    edit();
    bridge.saveOutcome = { status: "cancelled" };
    await saveAndClose();
    expect(bridge.allowCloseCalls).toBe(0);
  });
});

describe("documentLabel", () => {
  it("uses the graph name until the document has a file", () => {
    expect(documentLabel()).toBe("Test document");
  });

  it("uses the file's base name, without the extension, once saved", async () => {
    edit();
    bridge.saveOutcome = { status: "ok", filePath: "/Users/me/Ideas/Launch plan.mindgraph" };
    await saveDocument();
    expect(documentLabel()).toBe("Launch plan");
  });
});
