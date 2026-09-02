import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { CompoundFlowNode } from "./flowTypes.js";
import "./nodes.css";

/**
 * A node that contains a whole graph of its own.
 *
 * Collapsed, it is a card showing how much it holds. Expanded, it becomes a
 * container: the card's body drops away and React Flow draws the sub-graph's
 * nodes inside it, so the contents can be read and edited beside their
 * parent's siblings instead of on a separate canvas.
 */
export function CompoundNode({ data, selected }: NodeProps<CompoundFlowNode>) {
  const count = data.subgraph?.nodes.length ?? 0;
  // Set by the canvas, not by the document: both are view state.
  const expanded = data["expanded"] === true;
  const isDropTarget = data["dropTarget"] === true;

  return (
    <div
      className={[
        "node compound",
        expanded ? "expanded" : "",
        selected ? "selected" : "",
        isDropTarget ? "drop-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />

      <div className="node-title">
        {data.color && <span className="node-swatch" style={{ background: data.color }} />}
        {data.title || "Untitled group"}
      </div>

      {!expanded && data.description && <div className="node-description">{data.description}</div>}

      <div className="node-count">
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="3" cy="3" r="1.8" fill="currentColor" />
          <circle cx="9" cy="4.5" r="1.8" fill="currentColor" />
          <circle cx="5" cy="9.5" r="1.8" fill="currentColor" />
          <path d="M3 3 L9 4.5 M9 4.5 L5 9.5" stroke="currentColor" strokeWidth="0.9" fill="none" />
        </svg>
        {count === 0
          ? "empty"
          : `${count} node${count === 1 ? "" : "s"}${expanded ? "" : " inside"}`}
      </div>

      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}
