import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";

import { Canvas } from "./components/Canvas.js";
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

export function App() {
  useUndoShortcuts();

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <Canvas />
      </div>
    </ReactFlowProvider>
  );
}
