/**
 * Runs in an isolated context before the renderer loads, and is the sole bridge
 * between the sandboxed renderer and the main process.
 *
 * Only explicit, narrowly-typed functions are exposed. The renderer never
 * receives `ipcRenderer` itself, or anything derived from `require`, so it can
 * only invoke the exact channels named here.
 */

import { contextBridge, ipcRenderer } from "electron";

import type {
  DiscardChoice,
  DocumentState,
  MenuCommand,
  MindGraphBridge,
  OpenOutcome,
  SaveOutcome,
} from "../src/types/bridge.js";

const bridge: MindGraphBridge = {
  platform: process.platform,
  versions: {
    app: process.env["npm_package_version"] ?? "0.0.1",
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  },

  openDocument: () => ipcRenderer.invoke("document:open") as Promise<OpenOutcome>,
  readDocument: (filePath) =>
    ipcRenderer.invoke("document:read", filePath) as Promise<OpenOutcome>,
  saveDocument: (filePath, contents, suggestedName) =>
    ipcRenderer.invoke("document:save", filePath, contents, suggestedName) as Promise<SaveOutcome>,

  confirmDiscard: (documentName) =>
    ipcRenderer.invoke("document:confirm-discard", documentName) as Promise<DiscardChoice>,
  showError: (title, detail) =>
    ipcRenderer.invoke("document:show-error", title, detail) as Promise<void>,

  setDocumentState: (state: DocumentState) => ipcRenderer.send("document:state", state),

  onMenuCommand: (handler) => {
    // The IpcRendererEvent is deliberately not passed through: it carries
    // `sender`, which would hand the renderer a way back into IPC.
    const listener = (_event: unknown, command: MenuCommand) => handler(command);
    ipcRenderer.on("menu:command", listener);
    return () => {
      ipcRenderer.off("menu:command", listener);
    };
  },

  allowClose: () => ipcRenderer.send("document:allow-close"),
};

contextBridge.exposeInMainWorld("mindgraph", bridge);
