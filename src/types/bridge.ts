/**
 * The API surface the preload script exposes to the renderer, and the only
 * channel through which the renderer can reach the main process.
 *
 * Keep this deliberately small: everything added here widens the attack
 * surface of a renderer that is otherwise sandboxed. The renderer never touches
 * the filesystem — it hands the main process bytes and a path, and receives
 * bytes and a path back.
 *
 * Note the division of labour: the main process moves bytes, the renderer
 * decides what they mean. File *contents* are never parsed in main, so the
 * validator in `fileFormat.ts` stays the single place that decides whether a
 * document is well-formed.
 */

/** Outcome of an operation the user can cancel from a native dialog. */
export type FileOutcome<T> =
  | ({ status: "ok" } & T)
  | { status: "cancelled" }
  | { status: "error"; message: string };

export type OpenOutcome = FileOutcome<{ filePath: string; contents: string }>;
export type SaveOutcome = FileOutcome<{ filePath: string }>;

/** What the user chose when warned about unsaved work. */
export type DiscardChoice = "save" | "discard" | "cancel";

/** Commands the application menu sends to the renderer. */
export type MenuCommand = "new" | "open" | "save" | "save-as" | "save-and-close";

/** What the renderer tells main about the open document, for the title bar. */
export interface DocumentState {
  name: string;
  filePath: string | null;
  dirty: boolean;
}

export interface MindGraphBridge {
  /** `"darwin"` on macOS, `"win32"` on Windows. */
  readonly platform: NodeJS.Platform;
  readonly versions: {
    readonly app: string;
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };

  /** Shows the native Open dialog and reads the chosen file. */
  openDocument: () => Promise<OpenOutcome>;
  /** Reads a known path, for a file opened from the OS. */
  readDocument: (filePath: string) => Promise<OpenOutcome>;
  /**
   * Writes `contents`. With `filePath` null, asks for a location first.
   * The write is atomic: a crash mid-save cannot truncate the previous file.
   */
  saveDocument: (
    filePath: string | null,
    contents: string,
    suggestedName: string,
  ) => Promise<SaveOutcome>;

  /** Native "you have unsaved changes" prompt. */
  confirmDiscard: (documentName: string) => Promise<DiscardChoice>;
  /** Native error dialog, for unreadable or malformed files. */
  showError: (title: string, detail: string) => Promise<void>;

  /** Keeps the window title and macOS edited-dot in step with the document. */
  setDocumentState: (state: DocumentState) => void;
  /** Subscribes to menu commands. Returns an unsubscribe function. */
  onMenuCommand: (handler: (command: MenuCommand) => void) => () => void;
  /** Lets the window close after a save prompted by closing it. */
  allowClose: () => void;
}

declare global {
  interface Window {
    readonly mindgraph: MindGraphBridge;
  }
}
