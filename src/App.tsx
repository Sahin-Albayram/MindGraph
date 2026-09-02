import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";

import { Canvas, type Selection } from "./components/Canvas.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import {
  hasFileAccess,
  newDocument,
  openDocument,
  saveAndClose,
  saveDocument,
} from "./store/documentActions.js";
import { useGraphStore } from "./store/graphStore.js";
import { selectIsDirty } from "./store/selectors.js";

import "./App.css";

/**
 * Undo/redo keyboard shortcuts. `CmdOrCtrl` is spelled out by hand here because
 * this is the renderer; Step 8 moves these onto the application menu, where
 * Electron's accelerator strings handle the platform difference.
 */
function useUndoShortcuts(): void {
  const undo = useGraphStore((state) => state.undo);
  const redo = useGraphStore((state) => state.redo);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;

      // Let a focused text field keep its own undo stack.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(input|textarea)$/i.test(target?.tagName ?? "")) return;

      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
}

/**
 * Routes application-menu commands to the document actions. The menu lives in
 * the main process, so this is the renderer's half of File > New/Open/Save.
 */
function useMenuCommands(): void {
  useEffect(() => {
    if (!hasFileAccess()) return undefined;

    return window.mindgraph.onMenuCommand((command) => {
      switch (command) {
        case "new":
          void newDocument();
          break;
        case "open":
          void openDocument();
          break;
        case "save":
          void saveDocument();
          break;
        case "save-as":
          void saveDocument({ forceDialog: true });
          break;
        case "save-and-close":
          void saveAndClose();
          break;
      }
    });
  }, []);
}

/**
 * Keeps the native window title and the macOS edited-dot in step with the
 * document. The main process owns the window; the renderer owns the document,
 * so the document has to tell it.
 */
function useDocumentTitle(): void {
  const name = useGraphStore((state) => state.root.name);
  const filePath = useGraphStore((state) => state.filePath);
  const dirty = useGraphStore(selectIsDirty);

  useEffect(() => {
    if (!hasFileAccess()) return;
    window.mindgraph.setDocumentState({ name, filePath, dirty });
  }, [name, filePath, dirty]);
}

/**
 * Everything inside the React Flow provider. Selection is reported up from the
 * canvas, which already owns it — it is view state and must never reach the
 * document store or the saved file.
 */
function Workspace() {
  useUndoShortcuts();
  useMenuCommands();
  useDocumentTitle();

  const [selection, setSelection] = useState<Selection>({ nodeIds: [], edgeIds: [] });

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <Canvas onSelectionChange={setSelection} />
        <DetailPanel selection={selection} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}
