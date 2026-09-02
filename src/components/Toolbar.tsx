import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";

import { useGraphStore } from "../store/graphStore.js";
import {
  selectCanRedo,
  selectCanUndo,
  selectCurrentGraph,
  selectIsDirty,
} from "../store/selectors.js";
import { createCompoundNode, createIdeaNode } from "../utils/factories.js";
import { createSampleGraph } from "../utils/sampleGraph.js";
import { documentLabel } from "../store/documentActions.js";

import "./toolbar.css";

export function Toolbar() {
  const { screenToFlowPosition } = useReactFlow();

  const graph = useGraphStore(selectCurrentGraph);
  const isDirty = useGraphStore(selectIsDirty);
  // Once saved, the file's name is what the user recognises the document by.
  const filePath = useGraphStore((state) => state.filePath);
  const canUndo = useGraphStore(selectCanUndo);
  const canRedo = useGraphStore(selectCanRedo);
  const addNode = useGraphStore((state) => state.addNode);
  const undo = useGraphStore((state) => state.undo);
  const redo = useGraphStore((state) => state.redo);
  const loadDocument = useGraphStore((state) => state.loadDocument);

  /**
   * New nodes land in the middle of what the user is looking at, offset a
   * little each time so a run of additions does not stack into one pile.
   */
  const nextPosition = useCallback(() => {
    const centre = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const jitter = (graph.nodes.length % 6) * 28;
    return { x: Math.round(centre.x - 90 + jitter), y: Math.round(centre.y - 28 + jitter) };
  }, [graph.nodes.length, screenToFlowPosition]);

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <span className="toolbar-name">{filePath === null ? graph.name : documentLabel()}</span>
        {isDirty && <span className="toolbar-dirty" title="Unsaved changes" />}
      </div>

      <div className="toolbar-actions">
        <button type="button" onClick={() => addNode(createIdeaNode({ position: nextPosition() }))}>
          Add idea
        </button>
        <button
          type="button"
          onClick={() => addNode(createCompoundNode({ position: nextPosition() }))}
        >
          Add group
        </button>

        <span className="toolbar-divider" />

        <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Shift+Cmd/Ctrl+Z)">
          Redo
        </button>


        {import.meta.env.DEV && (
          <>
            <span className="toolbar-divider" />
            <button
              type="button"
              className="toolbar-dev"
              title="Development only — replaces the current document"
              onClick={() => loadDocument(createSampleGraph(), null)}
            >
              Load sample
            </button>
          </>
        )}
      </div>
    </header>
  );
}
