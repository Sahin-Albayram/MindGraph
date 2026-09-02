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
import type { Edge, Node } from "../types/graph.js";
import type { Selection } from "./Canvas.js";

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

/** Editor for a single edge: its label and whether it reads as tentative. */
function EdgeEditor({ edge }: { edge: Edge }) {
  const updateEdge = useGraphStore((state) => state.updateEdge);
  const endGesture = useGraphStore((state) => state.endGesture);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const endBurst = useCallback(() => {
    clearTimeout(idleTimer.current);
    endGesture();
  }, [endGesture]);

  useEffect(() => endBurst, [endBurst, edge.id]);

  return (
    <aside className="panel">
      <div className="panel-kind">Connection</div>

      <label className="panel-label" htmlFor="edge-label">
        Label
      </label>
      <input
        id="edge-label"
        className="panel-input"
        value={edge.label ?? ""}
        placeholder="How are these related?"
        onChange={(event) => {
          const value = event.target.value;
          updateEdge(edge.id, { label: value === "" ? undefined : value }, { coalesce: "label" });
          clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(endGesture, TYPING_IDLE_MS);
        }}
        onBlur={endBurst}
      />

      <div className="panel-label-row">
        <span className="panel-label">Strength</span>
        <div className="panel-toggle">
          <button
            type="button"
            className={edge.style === "dashed" ? "" : "active"}
            onClick={() => updateEdge(edge.id, { style: undefined })}
          >
            Solid
          </button>
          <button
            type="button"
            className={edge.style === "dashed" ? "active" : ""}
            onClick={() => updateEdge(edge.id, { style: "dashed" })}
          >
            Tentative
          </button>
        </div>
      </div>
      <p className="panel-hint">
        A tentative connection is drawn dashed — a link you suspect but have not
        settled.
      </p>
    </aside>
  );
}

interface DetailPanelProps {
  selection: Selection;
}

export function DetailPanel({ selection }: DetailPanelProps) {
  const graph = useGraphStore(selectCurrentGraph);
  const [showPreview, setShowPreview] = useState(false);

  const { nodeIds, edgeIds } = selection;
  const selectedId = nodeIds.length === 1 && edgeIds.length === 0 ? nodeIds[0] : undefined;
  const node: Node | undefined = graph.nodes.find((candidate) => candidate.id === selectedId);

  // Hooks must run unconditionally, so this sits above every early return.
  const { edit, endBurst } = useCoalescedEdit(node?.id);

  const total = nodeIds.length + edgeIds.length;

  if (total > 1) {
    const parts = [
      nodeIds.length > 0 ? `${nodeIds.length} node${nodeIds.length === 1 ? "" : "s"}` : null,
      edgeIds.length > 0
        ? `${edgeIds.length} connection${edgeIds.length === 1 ? "" : "s"}`
        : null,
    ].filter(Boolean);
    return (
      <aside className="panel">
        <p className="panel-empty">{parts.join(" and ")} selected</p>
      </aside>
    );
  }

  if (!node) {
    const edge = edgeIds.length === 1 ? graph.edges.find((e) => e.id === edgeIds[0]) : undefined;
    if (edge) return <EdgeEditor edge={edge} key={edge.id} />;

    return (
      <aside className="panel">
        <p className="panel-empty">Select a node or connection to edit it</p>
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
