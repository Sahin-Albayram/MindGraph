/**
 * Runs in an isolated context before the renderer loads, and is the sole bridge
 * between the sandboxed renderer and the main process.
 *
 * Only expose explicit, narrowly-typed functions here. Never hand the renderer
 * `ipcRenderer` itself, or anything derived from `require`.
 */

import { contextBridge } from "electron";

import type { MindGraphBridge } from "../src/types/bridge.js";

const bridge: MindGraphBridge = {
  platform: process.platform,
  versions: {
    app: process.env["npm_package_version"] ?? "0.0.1",
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  },
};

contextBridge.exposeInMainWorld("mindgraph", bridge);
