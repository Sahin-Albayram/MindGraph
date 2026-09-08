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
import { useViewStore } from "../store/viewStore.js";
import { containerBoxes, GROUP_HEADER, GROUP_PADDING } from "./flatten.js";

import "./toolbar.css";

export function Toolbar() {
  const { screenToFlowPosition } = useReactFlow();

  const graph = useGraphStore(selectCurrentGraph);
  const isDirty = useGraphStore(selectIsDirty);
  // The toolbar names the *document*; the breadcrumb bar says where inside it
  // you are. Using the current sub-graph's name here would duplicate the
  // breadcrumb and lose the document's identity while nested.
  const documentName = useGraphStore((state) => state.root.name);
  const filePath = useGraphStore((state) => state.filePath);
  const canUndo = useGraphStore(selectCanUndo);
  const canRedo = useGraphStore(selectCanRedo);
  const addNode = useGraphStore((state) => state.addNode);
  const basePath = useGraphStore((state) => state.path);
  const expanded = useViewStore((state) => state.expanded);
  const undo = useGraphStore((state) => state.undo);
  const redo = useGraphStore((state) => state.redo);
  const loadDocument = useGraphStore((state) => state.loadDocument);

  /**
   * Where a new node goes: the middle of what the user is actually looking at,
   * and *into* an expanded group if that is what is under the middle.
   *
   * Dropping it on top of a container it did not belong to was the confusing
   * case — it looked inside the group while the document said otherwise.
   */
  const nextPlacement = useCallback(() => {
    // The canvas is not the window: the detail panel takes 320px off the right,
    // and the toolbar and breadcrumbs take a strip off the top.
    const canvas = document.querySelector(".canvas")?.getBoundingClientRect();
    const centre = screenToFlowPosition(
      canvas
        ? { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    );

    const container = containerBoxes(graph, basePath, expanded)
      .filter(
        (box) =>
          centre.x >= box.x &&
          centre.x <= box.x + box.width &&
          centre.y >= box.y &&
          centre.y <= box.y + box.height,
      )
      // Innermost container wins, as it does for a drop.
      .at(-1);

    // Offset so the new node is centred on the point, then staggered a little
    // so a run of additions does not stack into one pile.
    const jitter = (graph.nodes.length % 6) * 28;
    const target = { x: centre.x - 90 + jitter, y: centre.y - 28 + jitter };

    if (!container) {
      return { path: basePath, position: { x: Math.round(target.x), y: Math.round(target.y) } };
    }

    return {
      path: container.path,
      position: {
        x: Math.max(0, Math.round(target.x - (container.x + GROUP_PADDING))),
        y: Math.max(0, Math.round(target.y - (container.y + GROUP_HEADER))),
      },
    };
  }, [graph, basePath, expanded, screenToFlowPosition]);

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <span className="toolbar-name">
          {filePath === null ? documentName : documentLabel()}
        </span>
        {isDirty && <span className="toolbar-dirty" title="Unsaved changes" />}
      </div>

      <div className="toolbar-actions">
        <button
          type="button"
          onClick={() => {
            const { path, position } = nextPlacement();
            addNode(createIdeaNode({ position }), path);
          }}
        >
          Add idea
        </button>
        <button
          type="button"
          onClick={() => {
            const { path, position } = nextPlacement();
            addNode(createCompoundNode({ position }), path);
          }}
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
