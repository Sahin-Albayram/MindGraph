import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { useGraphStore } from "./store/graphStore.js";
import "./styles.css";

// Development aid: lets the store be inspected from the devtools console
// (`__graphStore.getState()`), including the undo history. Stripped from
// production builds by the bundler.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)["__graphStore"] = useGraphStore;
}

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
