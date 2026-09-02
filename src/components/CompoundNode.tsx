import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { CompoundFlowNode } from "./flowTypes.js";
import "./nodes.css";

/**
 * A node that contains a whole graph of its own. Rendered as a container with
 * a count of what is inside; entering it is Step 7.
 */
export function CompoundNode({ data, selected }: NodeProps<CompoundFlowNode>) {
  const count = data.subgraph?.nodes.length ?? 0;

  return (
    <div className={`node compound${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="node-handle" />

      <div className="node-title">
        {data.color && <span className="node-swatch" style={{ background: data.color }} />}
        {data.title || "Untitled group"}
      </div>

      {data.description && <div className="node-description">{data.description}</div>}

      <div className="node-count">
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="3" cy="3" r="1.8" fill="currentColor" />
          <circle cx="9" cy="4.5" r="1.8" fill="currentColor" />
          <circle cx="5" cy="9.5" r="1.8" fill="currentColor" />
          <path d="M3 3 L9 4.5 M9 4.5 L5 9.5" stroke="currentColor" strokeWidth="0.9" fill="none" />
        </svg>
        {count === 0 ? "empty group" : `${count} node${count === 1 ? "" : "s"} inside`}
      </div>

      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}
