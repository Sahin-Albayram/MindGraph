/**
 * Editor for the selected node's title and markdown description.
 *
 * Typing goes straight to the store rather than into local draft state, so the
 * node card on the canvas updates live and there is no "unsaved in the panel"
 * state to reconcile. Edits coalesce into one history entry per burst — see
 * `useCoalescedEdit` — so undo reverses a sentence, not a keystroke.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";

import { useGraphStore } from "../store/graphStore.js";
import { selectCurrentGraph } from "../store/selectors.js";
import type { Node } from "../types/graph.js";

import "./detailPanel.css";

/** A pause longer than this ends the current undo entry. */
const TYPING_IDLE_MS = 700;

/**
 * Routes edits through the store's coalescing so a burst of typing is one undo
 * step, and closes the burst on an idle pause or on blur.
 */
function useCoalescedEdit(nodeId: string | undefined) {
  const updateNodeData = useGraphStore((state) => state.updateNodeData);
  const endGesture = useGraphStore((state) => state.endGesture);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const endBurst = useCallback(() => {
    clearTimeout(idleTimer.current);
    endGesture();
  }, [endGesture]);

  // A burst must not outlive the panel, or the next edit would merge into it.
  useEffect(() => endBurst, [endBurst, nodeId]);

  const edit = useCallback(
    (field: "title" | "description", value: string | undefined) => {
      if (!nodeId) return;
      updateNodeData(nodeId, { [field]: value }, { coalesce: field });
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(endGesture, TYPING_IDLE_MS);
    },
    [nodeId, updateNodeData, endGesture],
  );

  return { edit, endBurst };
}

interface DetailPanelProps {
  selectedIds: readonly string[];
}

export function DetailPanel({ selectedIds }: DetailPanelProps) {
  const nodes = useGraphStore((state) => selectCurrentGraph(state).nodes);
  const [showPreview, setShowPreview] = useState(false);

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const node: Node | undefined = nodes.find((candidate) => candidate.id === selectedId);
  const { edit, endBurst } = useCoalescedEdit(node?.id);

  if (selectedIds.length > 1) {
    return (
      <aside className="panel">
        <p className="panel-empty">{selectedIds.length} nodes selected</p>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="panel">
        <p className="panel-empty">Select a node to edit it</p>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <div className="panel-kind">{node.type === "compound" ? "Group" : "Idea"}</div>

      <label className="panel-label" htmlFor="node-title">
        Title
      </label>
      <input
        id="node-title"
        className="panel-input"
        value={node.data.title}
        placeholder="Untitled"
        onChange={(event) => edit("title", event.target.value)}
        onBlur={endBurst}
      />

      <div className="panel-label-row">
        <span className="panel-label">Description</span>
        <div className="panel-toggle">
          <button
            type="button"
            className={showPreview ? "" : "active"}
            onClick={() => setShowPreview(false)}
          >
            Write
          </button>
          <button
            type="button"
            className={showPreview ? "active" : ""}
            onClick={() => setShowPreview(true)}
          >
            Preview
          </button>
        </div>
      </div>

      {showPreview ? (
        <div className="panel-preview">
          {node.data.description ? (
            <Markdown>{node.data.description}</Markdown>
          ) : (
            <p className="panel-empty">Nothing to preview yet</p>
          )}
        </div>
      ) : (
        <textarea
          className="panel-textarea"
          value={node.data.description ?? ""}
          placeholder="Markdown supported — # headings, **bold**, - lists"
          spellCheck
          onChange={(event) =>
            // An empty box removes the field rather than saving an empty
            // string, so the file stays free of meaningless keys.
            edit("description", event.target.value === "" ? undefined : event.target.value)
          }
          onBlur={endBurst}
        />
      )}
    </aside>
  );
}
