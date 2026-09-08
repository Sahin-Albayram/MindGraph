/**
 * Filesystem access for the renderer, which has none of its own.
 *
 * These handlers move bytes and paths. They never parse document contents —
 * validation belongs to `src/utils/fileFormat.ts` in the renderer, so there is
 * exactly one place that decides whether a document is well-formed.
 */

import { BrowserWindow, dialog, ipcMain } from "electron";
import { constants } from "node:fs";
import { access, rename, unlink, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  DiscardChoice,
  DocumentState,
  OpenOutcome,
  SaveOutcome,
} from "../src/types/bridge.js";

export const FILE_EXTENSION = "mindgraph";

const FILE_FILTERS = [
  { name: "MindGraph Document", extensions: [FILE_EXTENSION] },
  { name: "All Files", extensions: ["*"] },
];

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function read(filePath: string): Promise<OpenOutcome> {
  try {
    const contents = await readFile(filePath, "utf8");
    return { status: "ok", filePath, contents };
  } catch (error) {
    return { status: "error", message: describe(error) };
  }
}

/**
 * Writes via a temporary file in the same directory, then renames over the
 * target. `rename` is atomic within a filesystem, so an interrupted save leaves
 * the previous version intact rather than a truncated one (spec section 8:
 * never lose work silently).
 */
async function writeAtomically(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, filePath);
  } catch (error) {
    // Leave no debris behind if the rename never happened.
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function suggestedPath(name: string): string {
  const base = name.trim() === "" ? "Untitled" : name.trim();
  // Strip anything that would be awkward or illegal in a filename on either
  // platform; Windows is the stricter of the two.
  const safe = base.replace(/[\\/:*?"<>|]/g, "-");
  return `${safe}.${FILE_EXTENSION}`;
}

/**
 * The "you have unsaved changes" prompt. Shared by the renderer (before New or
 * Open) and by the window's own close guard, so the wording and button order
 * are identical however the user arrives at it.
 */
export async function promptDiscard(
  window: BrowserWindow | null,
  documentName: string,
): Promise<DiscardChoice> {
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    // Cancel is last so Escape maps to it, and Save is default so Return is
    // the safe action rather than the destructive one.
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Unsaved Changes",
    message: `Do you want to save the changes you made to ${documentName}?`,
    detail: "Your changes will be lost if you don't save them.",
  };

  const { response } = await (window
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options));

  if (response === 0) return "save";
  if (response === 1) return "discard";
  return "cancel";
}

export interface FileHandlerHooks {
  /** Called when the renderer reports the document changed. */
  onDocumentState: (window: BrowserWindow, state: DocumentState) => void;
  /** Called when the renderer has finished saving during a close. */
  onAllowClose: (window: BrowserWindow) => void;
}

export function registerFileHandlers(hooks: FileHandlerHooks): void {
  const windowFor = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
    BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle("document:open", async (event): Promise<OpenOutcome> => {
    const window = windowFor(event);
    const result = await (window
      ? dialog.showOpenDialog(window, {
          title: "Open Diagram",
          filters: FILE_FILTERS,
          properties: ["openFile"],
        })
      : dialog.showOpenDialog({ filters: FILE_FILTERS, properties: ["openFile"] }));

    const [chosen] = result.filePaths;
    if (result.canceled || chosen === undefined) return { status: "cancelled" };
    return read(chosen);
  });

  ipcMain.handle("document:read", async (_event, filePath: unknown): Promise<OpenOutcome> => {
    if (typeof filePath !== "string") {
      return { status: "error", message: "A file path is required." };
    }
    try {
      await access(filePath, constants.R_OK);
    } catch (error) {
      return { status: "error", message: describe(error) };
    }
    return read(filePath);
  });

  ipcMain.handle(
    "document:save",
    async (
      event,
      filePath: unknown,
      contents: unknown,
      suggestedName: unknown,
    ): Promise<SaveOutcome> => {
      if (typeof contents !== "string") {
        return { status: "error", message: "Nothing to save." };
      }

      let target = typeof filePath === "string" && filePath !== "" ? filePath : null;

      if (target === null) {
        const window = windowFor(event);
        const defaultPath = suggestedPath(
          typeof suggestedName === "string" ? suggestedName : "Untitled",
        );
        const result = await (window
          ? dialog.showSaveDialog(window, {
              title: "Save Diagram",
              defaultPath,
              filters: FILE_FILTERS,
            })
          : dialog.showSaveDialog({ defaultPath, filters: FILE_FILTERS }));

        if (result.canceled || !result.filePath) return { status: "cancelled" };
        target = result.filePath;
      }

      try {
        await writeAtomically(target, contents);
        return { status: "ok", filePath: target };
      } catch (error) {
        return { status: "error", message: describe(error) };
      }
    },
  );

  ipcMain.handle(
    "document:confirm-discard",
    async (event, documentName: unknown): Promise<DiscardChoice> =>
      promptDiscard(
        windowFor(event),
        typeof documentName === "string" ? documentName : "this document",
      ),
  );

  ipcMain.handle("document:show-error", async (event, title: unknown, detail: unknown) => {
    const window = windowFor(event);
    const options: Electron.MessageBoxOptions = {
      type: "error",
      buttons: ["OK"],
      title: typeof title === "string" ? title : "Error",
      message: typeof title === "string" ? title : "Error",
      ...(typeof detail === "string" ? { detail } : {}),
    };
    await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
  });

  ipcMain.on("document:state", (event, state: unknown) => {
    const window = windowFor(event);
    if (!window || typeof state !== "object" || state === null) return;

    const candidate = state as Partial<DocumentState>;
    hooks.onDocumentState(window, {
      name: typeof candidate.name === "string" ? candidate.name : "Untitled",
      filePath: typeof candidate.filePath === "string" ? candidate.filePath : null,
      dirty: candidate.dirty === true,
    });
  });

  ipcMain.on("document:allow-close", (event) => {
    const window = windowFor(event);
    if (window) hooks.onAllowClose(window);
  });
}
