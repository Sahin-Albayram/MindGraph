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
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeTypes,
  type OnNodeDrag,
} from "@xyflow/react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import type { Graph, GraphPath } from "../types/graph.js";
import { useGraphStore } from "../store/graphStore.js";
import { selectCurrentGraph } from "../store/selectors.js";
import { useViewStore } from "../store/viewStore.js";
import { CompoundNode } from "./CompoundNode.js";
import {
  absolutePositions,
  containerBoxes,
  flatten,
  parseRef,
  refKey,
  GROUP_HEADER,
  GROUP_PADDING,
} from "./flatten.js";
import type { MindGraphFlowNode } from "./flowTypes.js";
import { IdeaNode } from "./IdeaNode.js";

import "@xyflow/react/dist/style.css";
import "./canvas.css";

// Defined once at module scope: React Flow warns and re-mounts every node if
// this object's identity changes between renders.
const nodeTypes: NodeTypes = {
  idea: IdeaNode,
  compound: CompoundNode,
};

export interface Selection {
  /** Composite refs — see `flatten.ts`. Decode with `parseRef`. */
  nodeIds: readonly string[];
  edgeIds: readonly string[];
}

export interface CanvasProps {
  /** Reports the current selection upward. Selection is view state: it lives
   *  here, in React Flow's own copy, and never reaches the store or the file. */
  onSelectionChange?: ((selection: Selection) => void) | undefined;
}

export function Canvas({ onSelectionChange }: CanvasProps) {
  const graph = useGraphStore(selectCurrentGraph);
  const basePath = useGraphStore((state) => state.path);
  const moveNode = useGraphStore((state) => state.moveNode);
  const deleteElements = useGraphStore((state) => state.deleteElements);
  const connect = useGraphStore((state) => state.connect);
  const moveNodeToGraph = useGraphStore((state) => state.moveNodeToGraph);
  const setViewport = useGraphStore((state) => state.setViewport);
  const endGesture = useGraphStore((state) => state.endGesture);

  const expanded = useViewStore((state) => state.expanded);
  const toggleExpanded = useViewStore((state) => state.toggleExpanded);

  const [nodes, setNodes] = useState<MindGraphFlowNode[]>(
    () => flatten(graph, basePath, expanded).nodes,
  );
  const [edges, setEdges] = useState<FlowEdge[]>(() => flatten(graph, basePath, expanded).edges);

  // Re-sync whenever the document or the expansion set changes. Existing nodes
  // are updated in place rather than replaced, so React Flow keeps the
  // measurements it has already taken.
  useEffect(() => {
    const next = flatten(graph, basePath, expanded);

    setNodes((current) => {
      const existing = new Map(current.map((node) => [node.id, node]));
      return next.nodes.map((node) => {
        const previous = existing.get(node.id);
        return previous ? { ...previous, ...node } : node;
      });
    });

    setEdges((current) => {
      const existing = new Map(current.map((edge) => [edge.id, edge]));
      return next.edges.map((edge) => ({ ...existing.get(edge.id), ...edge }));
    });
  }, [graph, basePath, expanded]);

  // Derived as strings so the effect below fires on a genuine selection change
  // rather than on every new array identity.
  const selectedNodeKey = nodes
    .filter((node) => node.selected)
    .map((node) => node.id)
    .join("\u0000");
  const selectedEdgeKey = edges
    .filter((edge) => edge.selected)
    .map((edge) => edge.id)
    .join("\u0000");

  useEffect(() => {
    onSelectionChange?.({
      nodeIds: selectedNodeKey === "" ? [] : selectedNodeKey.split("\u0000"),
      edgeIds: selectedEdgeKey === "" ? [] : selectedEdgeKey.split("\u0000"),
    });
  }, [selectedNodeKey, selectedEdgeKey, onSelectionChange]);

  /**
   * Connections may only join two nodes of the same graph. Once a group is
   * expanded its children are visible beside their parent's siblings, so this
   * rule has to be enforced where the user can see it: the drop is refused
   * mid-drag rather than accepted and then rejected by the file validator.
   *
   * The meaning is deliberate — to relate a group to something outside it,
   * connect the group itself.
   */
  const isValidConnection = useCallback<IsValidConnection>(
    ({ source, target }) => {
      if (source === null || target === null || source === target) return false;

      const from = parseRef(source);
      const to = parseRef(target);
      if (from.path.join("\u0000") !== to.path.join("\u0000")) return false;

      const owner = resolveOwner(graph, basePath, from.path);
      if (!owner) return false;
      return !owner.edges.some((edge) => edge.source === from.id && edge.target === to.id);
    },
    [graph, basePath],
  );

  const onConnect = useCallback(
    ({ source, target }: Connection) => {
      if (source === null || target === null) return;
      const from = parseRef(source);
      const to = parseRef(target);
      if (from.path.join("\u0000") !== to.path.join("\u0000")) return;
      connect(from.id, to.id, { path: from.path });
    },
    [connect],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<MindGraphFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;

        const ref = parseRef(change.id);
        const isChild = ref.path.length > basePath.length;
        // A child's position is reported relative to its container, so the
        // container's padding and header have to come back off before storing.
        const position = isChild
          ? { x: change.position.x - GROUP_PADDING, y: change.position.y - GROUP_HEADER }
          : change.position;

        moveNode(ref.id, position, {
          coalesce: change.dragging === true,
          path: ref.path,
        });
      }
    },
    [moveNode, basePath],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  /**
   * One delete gesture, one store transaction, one undo — even when the
   * selection spans a container and its contents.
   */
  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: MindGraphFlowNode[]; edges: FlowEdge[] }) => {
      deleteElements({
        refs: {
          nodes: deletedNodes.map((node) => parseRef(node.id)),
          edges: deletedEdges.map((edge) => parseRef(edge.id)),
        },
      });
    },
    [deleteElements],
  );

  /**
   * Where a node ends up when the drag stops: whichever expanded container its
   * centre lies in, innermost first, or the graph on screen if none.
   *
   * A group cannot be dropped into itself or into anything it contains, and a
   * drop that does not change graph is left to the ordinary move path.
   */
  const onNodeDragStop = useCallback<OnNodeDrag<MindGraphFlowNode>>(
    (_event, node) => {
      endGesture();

      const ref = parseRef(node.id);
      const positions = absolutePositions(graph, basePath, expanded);
      const origin = positions.get(node.id);
      if (!origin) return;

      // The node's own box, measured where React Flow last drew it.
      const width = node.measured?.width ?? 200;
      const height = node.measured?.height ?? 60;
      const centre = { x: origin.x + width / 2, y: origin.y + height / 2 };

      const target = containerBoxes(graph, basePath, expanded)
        .filter((box) => {
          // Never into itself, and never into its own descendants.
          if (box.path.slice(0, ref.path.length + 1).join("\u0000") ===
              [...ref.path, ref.id].join("\u0000")) {
            return false;
          }
          return (
            centre.x >= box.x &&
            centre.x <= box.x + box.width &&
            centre.y >= box.y &&
            centre.y <= box.y + box.height
          );
        })
        // Innermost container wins.
        .at(-1);

      const toPath = target ? target.path : basePath;
      if (toPath.join("\u0000") === ref.path.join("\u0000")) return;

      // Absolute position translated into the destination graph's coordinates.
      const destinationOrigin = target
        ? { x: target.x + GROUP_PADDING, y: target.y + GROUP_HEADER }
        : { x: 0, y: 0 };

      // A drop is decided by the node's centre, so its edge can still fall
      // outside the container. Keep it wholly inside rather than straddling
      // the border it was just dropped into.
      const local = {
        x: Math.round(origin.x - destinationOrigin.x),
        y: Math.round(origin.y - destinationOrigin.y),
      };
      const position = target ? { x: Math.max(0, local.x), y: Math.max(0, local.y) } : local;

      moveNodeToGraph({ nodeId: ref.id, from: ref.path, to: toPath, position });
    },
    [endGesture, graph, basePath, expanded, moveNodeToGraph],
  );

  /** Double-clicking a group opens or closes it in place. */
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: MindGraphFlowNode) => {
      if (node.type === "compound") toggleExpanded(node.id);
    },
    [toggleExpanded],
  );

  return (
    <div className="canvas">
      <ReactFlow
        // Remounting per graph gives each sub-graph its own camera rather than
        // carrying one viewport across the whole document.
        key={refKey(basePath, graph.id)}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDelete={onDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStop={onNodeDragStop}
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

/** The graph at `path`, given that `graph` is the one shown at `basePath`. */
function resolveOwner(graph: Graph, basePath: GraphPath, path: GraphPath): Graph | null {
  let current: Graph = graph;
  for (const nodeId of path.slice(basePath.length)) {
    const subgraph = current.nodes.find((node) => node.id === nodeId)?.data.subgraph;
    if (!subgraph) return null;
    current = subgraph;
  }
  return current;
}
