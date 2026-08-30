import "./App.css";

/**
 * Step 1 scaffold screen. Its job is to prove the whole chain works — Electron
 * launches, Vite serves, React renders, and the preload bridge reached the
 * renderer with `contextIsolation` on. The canvas replaces it in Step 3.
 */
export function App() {
  // Guarded rather than assumed: if the preload script fails to load, the
  // window would otherwise render a blank screen with no explanation.
  const bridge = typeof window !== "undefined" ? window.mindgraph : undefined;

  const platformName =
    bridge?.platform === "darwin"
      ? "macOS"
      : bridge?.platform === "win32"
        ? "Windows"
        : (bridge?.platform ?? "unknown");

  return (
    <main className="shell">
      <section className="card">
        <h1>MindGraph</h1>
        <p className="tagline">
          Visual brainstorming with directed graphs and nestable sub-graphs.
        </p>

        {bridge ? (
          <p className="status ok">Preload bridge connected — running on {platformName}.</p>
        ) : (
          <p className="status fail">
            Preload bridge unavailable. The renderer cannot reach the main
            process; check the preload path in <code>electron/main.ts</code>.
          </p>
        )}

        {bridge && (
          <dl className="facts">
            <dt>Electron</dt>
            <dd>{bridge.versions.electron}</dd>
            <dt>Chromium</dt>
            <dd>{bridge.versions.chrome}</dd>
            <dt>Node</dt>
            <dd>{bridge.versions.node}</dd>
          </dl>
        )}

        <p className="next">
          Step 1 of the build order is complete. Next: <strong>Step 2</strong> —
          the Zustand store holding the root graph and the sub-graph path.
        </p>
      </section>
    </main>
  );
}
