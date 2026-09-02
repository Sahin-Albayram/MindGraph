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

import { useGraphStore, type ElementRef } from "../store/graphStore.js";
import { useViewStore } from "../store/viewStore.js";
import type { Edge, Graph, Node } from "../types/graph.js";
import type { Selection } from "./Canvas.js";
import { parseRef, refKey } from "./flatten.js";
import { resolveGraph } from "../utils/graphPath.js";

import "./detailPanel.css";

/** A pause longer than this ends the current undo entry. */
const TYPING_IDLE_MS = 700;

/**
 * Routes edits through the store's coalescing so a burst of typing is one undo
 * step, and closes the burst on an idle pause or on blur.
 */
function useCoalescedEdit(ref: ElementRef | undefined) {
  const updateNodeData = useGraphStore((state) => state.updateNodeData);
  const endGesture = useGraphStore((state) => state.endGesture);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const endBurst = useCallback(() => {
    clearTimeout(idleTimer.current);
    endGesture();
  }, [endGesture]);

  // A burst must not outlive the panel, or the next edit would merge into it.
  useEffect(() => endBurst, [endBurst, ref?.id]);

  const edit = useCallback(
    (field: "title" | "description", value: string | undefined) => {
      if (!ref) return;
      updateNodeData(ref.id, { [field]: value }, { coalesce: field, path: ref.path });
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(endGesture, TYPING_IDLE_MS);
    },
    [ref, updateNodeData, endGesture],
  );

  return { edit, endBurst };
}

/** Editor for a single edge: its label and whether it reads as tentative. */
function EdgeEditor({ edge, path }: { edge: Edge; path: readonly string[] }) {
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
          updateEdge(
            edge.id,
            { label: value === "" ? undefined : value },
            { coalesce: "label", path },
          );
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
            onClick={() => updateEdge(edge.id, { style: undefined }, { path })}
          >
            Solid
          </button>
          <button
            type="button"
            className={edge.style === "dashed" ? "active" : ""}
            onClick={() => updateEdge(edge.id, { style: "dashed" }, { path })}
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

/**
 * Turning an idea into a group, and opening one. Both are offered here because
 * the canvas affordance — double-click — is not discoverable on its own.
 */
function NestingControls({ node, nodeRef }: { node: Node; nodeRef: ElementRef }) {
  const convertToCompound = useGraphStore((state) => state.convertToCompound);
  const enterSubgraph = useGraphStore((state) => state.enterSubgraph);
  const expanded = useViewStore((state) => state.expanded);
  const setExpanded = useViewStore((state) => state.setExpanded);

  const key = refKey(nodeRef.path, nodeRef.id);
  const isOpen = expanded.has(key);

  if (node.type !== "compound") {
    return (
      <div className="panel-nesting">
        <button
          type="button"
          className="panel-action"
          onClick={() => convertToCompound(node.id, nodeRef.path)}
        >
          Turn into a group
        </button>
        <p className="panel-hint">
          A group holds a whole graph of its own, so this idea can be explored
          without crowding the canvas it sits on.
        </p>
      </div>
    );
  }

  const count = node.data.subgraph?.nodes.length ?? 0;

  return (
    <div className="panel-nesting">
      <button type="button" className="panel-action" onClick={() => setExpanded(key, !isOpen)}>
        {isOpen ? "Close group" : "Open group here"}
      </button>
      {/* Focus mode: give the group the whole canvas, with breadcrumbs back. */}
      <button
        type="button"
        className="panel-action panel-action-quiet"
        onClick={() => enterSubgraph(node.id)}
        disabled={nodeRef.path.length > 0}
        title={
          nodeRef.path.length > 0
            ? "Only a group at the current level can be focused"
            : undefined
        }
      >
        Focus on it
      </button>
      <p className="panel-hint">
        {count === 0
          ? "This group is empty. Open it to start building inside."
          : `Contains ${count} node${count === 1 ? "" : "s"}. Double-clicking the group opens it too.`}
      </p>
    </div>
  );
}

interface DetailPanelProps {
  selection: Selection;
}

export function DetailPanel({ selection }: DetailPanelProps) {
  const root = useGraphStore((state) => state.root);
  const [showPreview, setShowPreview] = useState(false);

  const { nodeIds, edgeIds } = selection;
  const selectedKey = nodeIds.length === 1 && edgeIds.length === 0 ? nodeIds[0] : undefined;
  // Selection carries a full path, because an expanded group puts nodes from
  // several graphs on screen at once.
  const nodeRef = selectedKey === undefined ? undefined : parseRef(selectedKey);
  const owner: Graph | null = nodeRef ? resolveGraph(root, nodeRef.path) : null;
  const node: Node | undefined = owner?.nodes.find((candidate) => candidate.id === nodeRef!.id);

  // Hooks must run unconditionally, so this sits above every early return.
  const { edit, endBurst } = useCoalescedEdit(node ? nodeRef : undefined);

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
    const edgeRef = edgeIds.length === 1 ? parseRef(edgeIds[0]!) : undefined;
    const edgeOwner = edgeRef ? resolveGraph(root, edgeRef.path) : null;
    const edge = edgeOwner?.edges.find((candidate) => candidate.id === edgeRef!.id);
    if (edge && edgeRef) return <EdgeEditor edge={edge} path={edgeRef.path} key={edge.id} />;

    return (
      <aside className="panel">
        <p className="panel-empty">Select a node or connection to edit it</p>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <div className="panel-kind">{node.type === "compound" ? "Group" : "Idea"}</div>

      <NestingControls node={node} nodeRef={nodeRef!} />

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
