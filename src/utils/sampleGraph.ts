/**
 * A populated document for trying the canvas out, so there is something to
 * click around in without hand-building a graph first. Development only — the
 * Toolbar button that loads it is compiled out of packaged builds.
 */

import type { Graph } from "../types/graph.js";
import { createCompoundNode, createEdge, createGraph, createIdeaNode } from "./factories.js";

export function createSampleGraph(): Graph {
  const root = createGraph({ name: "Sample brainstorm" });

  const premise = createIdeaNode({
    title: "Ship MindGraph 1.0",
    position: { x: 40, y: 180 },
    description: "The thing we are actually trying to do.",
  });

  const research = createIdeaNode({
    title: "Talk to five users",
    position: { x: 360, y: 40 },
    description: "Do people actually want nested graphs?",
  });

  const risk = createIdeaNode({
    title: "Performance at 500 nodes",
    position: { x: 360, y: 320 },
  });
  risk.data.tags = ["risk"];

  // A compound node with real contents, so the nested-graph affordance shows
  // a meaningful count rather than an empty group.
  const inner = createGraph({ name: "Distribution" });
  const hn = createIdeaNode({ title: "Show HN", position: { x: 20, y: 20 } });
  const forums = createIdeaNode({ title: "Niche forums", position: { x: 240, y: 120 } });
  const blog = createIdeaNode({ title: "Build-log posts", position: { x: 20, y: 220 } });
  inner.nodes = [hn, forums, blog];
  inner.edges = [
    createEdge({ source: hn.id, target: forums.id, label: "spillover" }),
    createEdge({ source: blog.id, target: hn.id, style: "dashed" }),
  ];

  const distribution = createCompoundNode({
    title: "Distribution",
    position: { x: 700, y: 180 },
    subgraph: inner,
  });

  root.nodes = [premise, research, risk, distribution];
  root.edges = [
    createEdge({ source: premise.id, target: research.id, label: "validate" }),
    createEdge({ source: premise.id, target: risk.id, style: "dashed" }),
    createEdge({ source: research.id, target: distribution.id }),
  ];

  return root;
}
