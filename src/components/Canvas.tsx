/**
 * React Flow bound to the document store.
 *
 * The store stays authoritative for the document, but React Flow keeps its own
 * copy of the nodes and edges, and that copy is deliberately *not* rebuilt from
 * scratch each render. React Flow annotates the objects it is given with
 * measurements and interaction state; handing it fresh objects every time
 * discards those annotations, and it then refuses to drag nodes it considers
 * uninitialised.
 *
 * So: `applyNodeChanges` maintains the local copy, the store receives the
 * document-level consequences (moves, deletions), and an effect re-syncs the
 * local copy when the document changes from elsewhere — undo, load, or entering
 * a sub-graph — preserving each node's measurements across the sync.
 *
 * Selection stays purely in React Flow's copy: it is view state, and must never
 * reach the file.
 */

import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge as FlowEdge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";

import type { Edge, Node } from "../types/graph.js";
import { useGraphStore } from "../store/graphStore.js";
import { selectCurrentGraph } from "../store/selectors.js";
import { CompoundNode } from "./CompoundNode.js";
import type { FlowNodeData, MindGraphFlowNode } from "./flowTypes.js";
import { IdeaNode } from "./IdeaNode.js";

import "@xyflow/react/dist/style.css";
import "./canvas.css";

// Defined once at module scope: React Flow warns and re-mounts every node if
// this object's identity changes between renders.
const nodeTypes: NodeTypes = {
  idea: IdeaNode,
  compound: CompoundNode,
};

function toFlowNode(node: Node): MindGraphFlowNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    // Widening only: every field of NodeData keeps its own type.
    data: node.data as FlowNodeData,
  };
}

function toFlowEdge(edge: Edge): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    // Spread conditionally: `exactOptionalPropertyTypes` rejects an explicit
    // `undefined` for an optional property.
    ...(edge.style === "dashed" ? { style: { strokeDasharray: "6 4" } } : {}),
  };
}

export interface CanvasProps {
  /** Reports the selected node ids upward. Selection is view state: it lives
   *  here, in React Flow's own copy, and never reaches the store or the file. */
  onSelectionChange?: ((nodeIds: readonly string[]) => void) | undefined;
}

export function Canvas({ onSelectionChange }: CanvasProps) {
  const graph = useGraphStore(selectCurrentGraph);
  const moveNode = useGraphStore((state) => state.moveNode);
  const deleteElements = useGraphStore((state) => state.deleteElements);
  const setViewport = useGraphStore((state) => state.setViewport);
  const endGesture = useGraphStore((state) => state.endGesture);

  const [nodes, setNodes] = useState<MindGraphFlowNode[]>(() => graph.nodes.map(toFlowNode));
  const [edges, setEdges] = useState<FlowEdge[]>(() => graph.edges.map(toFlowEdge));

  // Re-sync when the document changes from outside the canvas. Existing nodes
  // are updated in place rather than replaced, so React Flow keeps the
  // measurements it has already taken.
  useEffect(() => {
    setNodes((current) => {
      const existing = new Map(current.map((node) => [node.id, node]));
      return graph.nodes.map((node) => {
        const previous = existing.get(node.id);
        if (!previous) return toFlowNode(node);
        return {
          ...previous,
          type: node.type,
          position: node.position,
          data: node.data as FlowNodeData,
        };
      });
    });
  }, [graph.nodes]);

  useEffect(() => {
    setEdges((current) => {
      const existing = new Map(current.map((edge) => [edge.id, edge]));
      return graph.edges.map((edge) => ({ ...existing.get(edge.id), ...toFlowEdge(edge) }));
    });
  }, [graph.edges]);

  // Derived as a string so the effect below fires on a genuine selection
  // change rather than on every new array identity.
  const selectedKey = nodes
    .filter((node) => node.selected)
    .map((node) => node.id)
    .join("\u0000");

  useEffect(() => {
    onSelectionChange?.(selectedKey === "" ? [] : selectedKey.split("\u0000"));
  }, [selectedKey, onSelectionChange]);

  const onNodesChange = useCallback(
    (changes: NodeChange<MindGraphFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      for (const change of changes) {
        switch (change.type) {
          case "position":
            // `dragging` is true for every frame of a drag; those collapse into
            // a single history entry, and onNodeDragStop closes the gesture.
            if (change.position) {
              moveNode(change.id, change.position, { coalesce: change.dragging === true });
            }
            break;
          default:
            // Selection and dimension changes are view state; React Flow's own
            // copy is the right and only home for them. Deletions arrive via
            // onDelete instead, which reports nodes and edges together.
            break;
        }
      }
    },
    [moveNode],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  /**
   * One delete gesture, one store transaction, one undo — React Flow would
   * otherwise report the node and its edges through two separate change
   * callbacks, costing two undo presses to reverse a single Delete press.
   */
  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: MindGraphFlowNode[]; edges: FlowEdge[] }) => {
      deleteElements({
        nodeIds: deletedNodes.map((node) => node.id),
        edgeIds: deletedEdges.map((edge) => edge.id),
      });
    },
    [deleteElements],
  );

  return (
    <div className="canvas">
      <ReactFlow
        // Remounting per graph gives each sub-graph its own camera rather than
        // carrying one viewport across the whole document.
        key={graph.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onDelete={onDelete}
        onNodeDragStop={endGesture}
        onMoveEnd={(_event, viewport) => setViewport(viewport)}
        defaultViewport={graph.viewport}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
