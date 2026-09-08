/**
 * Bridging types between our data model and React Flow's generics.
 *
 * React Flow requires node data to be index-signature compatible
 * (`Record<string, unknown>`). Intersecting rather than loosening `NodeData`
 * keeps every field of ours precisely typed while satisfying that constraint,
 * so the model stays the source of truth.
 */

import type { Node as FlowNode } from "@xyflow/react";

import type { NodeData } from "../types/graph.js";

export type FlowNodeData = NodeData & Record<string, unknown>;

export type IdeaFlowNode = FlowNode<FlowNodeData, "idea">;
export type CompoundFlowNode = FlowNode<FlowNodeData, "compound">;
export type MindGraphFlowNode = IdeaFlowNode | CompoundFlowNode;
