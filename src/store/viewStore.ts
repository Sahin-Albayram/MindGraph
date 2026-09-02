/**
 * View state that must never reach the saved file: which groups are currently
 * expanded on the canvas.
 *
 * Kept apart from the document store deliberately. Expansion is how you are
 * looking at a document, not part of it — so it costs no undo entry, never
 * marks the document dirty, and is forgotten when the app closes.
 */

import { create } from "zustand";

interface ViewState {
  /** Composite refs (`refKey`) of groups drawn open. */
  expanded: ReadonlySet<string>;
  toggleExpanded: (key: string) => void;
  setExpanded: (key: string, open: boolean) => void;
  collapseAll: () => void;
}

export const useViewStore = create<ViewState>()((set) => ({
  expanded: new Set<string>(),

  toggleExpanded: (key) =>
    set((state) => {
      const next = new Set(state.expanded);
      if (!next.delete(key)) next.add(key);
      return { expanded: next };
    }),

  setExpanded: (key, open) =>
    set((state) => {
      if (state.expanded.has(key) === open) return {};
      const next = new Set(state.expanded);
      if (open) next.add(key);
      else next.delete(key);
      return { expanded: next };
    }),

  collapseAll: () => set((state) => (state.expanded.size === 0 ? {} : { expanded: new Set() })),

}));
