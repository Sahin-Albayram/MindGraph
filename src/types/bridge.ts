/**
 * The API surface the preload script exposes to the renderer, and the only
 * channel through which the renderer can reach the main process.
 *
 * Keep this deliberately small: everything added here widens the attack
 * surface of a renderer that is otherwise sandboxed. File operations join it
 * in Step 6 (`openFile`, `saveFile`, `saveFileAs`, `getRecents`).
 */

export interface MindGraphBridge {
  /** `"darwin"` on macOS, `"win32"` on Windows. */
  readonly platform: NodeJS.Platform;
  readonly versions: {
    readonly app: string;
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
}

declare global {
  interface Window {
    readonly mindgraph: MindGraphBridge;
  }
}
