import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { IdeaFlowNode } from "./flowTypes.js";
import "./nodes.css";

/**
 * A plain idea. The card shows a hint of the description; the full markdown
 * lives in the detail panel (Step 4).
 *
 * Handles are rendered but not connectable — edges are drawn from them in
 * Step 5. They exist now so an edge loaded from a file has somewhere to attach.
 */
export function IdeaNode({ data, selected }: NodeProps<IdeaFlowNode>) {
  return (
    <div className={`node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="node-handle" isConnectable={false} />

      <div className="node-title">
        {data.color && <span className="node-swatch" style={{ background: data.color }} />}
        {data.title || "Untitled"}
      </div>

      {data.description && <div className="node-description">{data.description}</div>}

      {data.tags && data.tags.length > 0 && (
        <div className="node-tags">
          {data.tags.map((tag) => (
            <span className="node-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="node-handle" isConnectable={false} />
    </div>
  );
}
