/**
 * New / Open / Save, orchestrated between the store and the preload bridge.
 *
 * Kept out of components because the same operations arrive from two places —
 * the application menu and the window's close guard — and both must behave
 * identically. Every one of them is guarded: nothing discards unsaved work
 * without asking (spec section 8).
 */

import { useGraphStore } from "./graphStore.js";
import { selectIsDirty } from "./selectors.js";
import { deserialize, serialize } from "../utils/fileFormat.js";
import { createGraph } from "../utils/factories.js";

/** Whether the app is running inside Electron and can reach the filesystem. */
export function hasFileAccess(): boolean {
  return typeof window !== "undefined" && window.mindgraph !== undefined;
}

/** The name to show the user for the current document. */
export function documentLabel(): string {
  const { root, filePath } = useGraphStore.getState();
  if (filePath === null) return root.name;
  const base = filePath.split(/[\\/]/).pop() ?? root.name;
  return base.replace(/\.mindgraph$/i, "");
}

/**
 * Writes the current document. With no path yet — or when `forceDialog` is set
 * — asks the user where. Returns whether the document ended up on disk.
 */
export async function saveDocument({ forceDialog = false } = {}): Promise<boolean> {
  if (!hasFileAccess()) return false;

  const state = useGraphStore.getState();
  const contents = serialize(state.root);
  const target = forceDialog ? null : state.filePath;

  const outcome = await window.mindgraph.saveDocument(target, contents, state.root.name);

  if (outcome.status === "error") {
    await window.mindgraph.showError("Could not save the diagram", outcome.message);
    return false;
  }
  if (outcome.status === "cancelled") return false;

  useGraphStore.getState().markSaved(outcome.filePath);
  return true;
}

/**
 * Offers to save when there is unsaved work. Returns false only if the user
 * cancelled, meaning the caller must abandon whatever it was about to do.
 */
async function confirmDiscard(): Promise<boolean> {
  if (!hasFileAccess()) return true;
  if (!selectIsDirty(useGraphStore.getState())) return true;

  const choice = await window.mindgraph.confirmDiscard(documentLabel());
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return saveDocument();
}

export async function newDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  useGraphStore.getState().loadDocument(createGraph({ name: "Untitled" }), null);
}

/** Loads the text of a `.mindgraph` file, reporting any problems it contains. */
async function adopt(filePath: string, contents: string): Promise<boolean> {
  const parsed = deserialize(contents);

  if (!parsed.ok) {
    // The validator collects every problem with a JSON path, so the user gets
    // a repair list rather than "could not open".
    await window.mindgraph.showError(
      "This file could not be opened",
      `${filePath}\n\n${parsed.errors.join("\n")}`,
    );
    return false;
  }

  useGraphStore.getState().loadDocument(parsed.file.graph, filePath);

  if (parsed.warnings.length > 0) {
    // Warnings are survivable, so the document is already open behind this.
    await window.mindgraph.showError(
      "Opened with warnings",
      `${filePath}\n\n${parsed.warnings.join("\n")}`,
    );
  }
  return true;
}

export async function openDocument(): Promise<void> {
  if (!hasFileAccess()) return;
  if (!(await confirmDiscard())) return;

  const outcome = await window.mindgraph.openDocument();
  if (outcome.status === "cancelled") return;
  if (outcome.status === "error") {
    await window.mindgraph.showError("Could not open the diagram", outcome.message);
    return;
  }

  await adopt(outcome.filePath, outcome.contents);
}

/**
 * Save triggered by closing the window. On success the main process is told it
 * may proceed; on failure or cancel the window simply stays open.
 */
export async function saveAndClose(): Promise<void> {
  if (await saveDocument()) window.mindgraph.allowClose();
}
