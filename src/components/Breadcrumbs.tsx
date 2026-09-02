/**
 * The trail from the root graph down to the sub-graph on screen, and the way
 * back out.
 *
 * Navigation is not an edit: moving between graphs never touches the document
 * or the undo history (see `graphStore.ts`).
 */

import { useMemo } from "react";

import { useGraphStore } from "../store/graphStore.js";
import { breadcrumbs } from "../utils/graphPath.js";

import "./breadcrumbs.css";

export function Breadcrumbs() {
  // Selected as two stable references and combined here, rather than through
  // one selector: `breadcrumbs()` allocates a fresh array each call, and a
  // selector that never returns the same reference re-renders forever.
  const root = useGraphStore((state) => state.root);
  const path = useGraphStore((state) => state.path);
  const navigateTo = useGraphStore((state) => state.navigateTo);

  const trail = useMemo(() => breadcrumbs(root, path), [root, path]);

  const last = trail.length - 1;

  return (
    <nav className="breadcrumbs" aria-label="Sub-graph trail">
      {trail.map((crumb, index) => (
        <span className="breadcrumb-item" key={crumb.nodeId ?? "__root__"}>
          {index > 0 && (
            <span className="breadcrumb-separator" aria-hidden="true">
              ›
            </span>
          )}
          {index === last ? (
            <span className="breadcrumb-current" aria-current="page">
              {crumb.label || "Untitled"}
            </span>
          ) : (
            <button
              type="button"
              className="breadcrumb-link"
              onClick={() => navigateTo(crumb.depth)}
            >
              {crumb.label || "Untitled"}
            </button>
          )}
        </span>
      ))}

      {trail.length > 1 && (
        <span className="breadcrumb-depth">
          {trail.length - 1} level{trail.length - 1 === 1 ? "" : "s"} deep
        </span>
      )}
    </nav>
  );
}
