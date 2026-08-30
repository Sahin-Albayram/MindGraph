import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";

import { Canvas } from "./components/Canvas.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { Toolbar } from "./components/Toolbar.js";
import { useGraphStore } from "./store/graphStore.js";

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
 * Everything inside the React Flow provider. Selection is reported up from the
 * canvas, which already owns it — it is view state and must never reach the
 * document store or the saved file.
 */
function Workspace() {
  useUndoShortcuts();

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <Canvas onSelectionChange={setSelectedIds} />
        <DetailPanel selectedIds={selectedIds} />
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
