import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electronSimple from "vite-plugin-electron/simple";

/*
 * vite-plugin-electron picks the output format from package.json's `type`
 * field. package.json deliberately omits it, so the main process and preload
 * script are emitted as CommonJS — an ESM preload would force `sandbox: false`,
 * and the sandbox is worth more than the module syntax.
 */

export default defineConfig(async () => ({
  plugins: [
    react(),
    ...(await electronSimple({
      main: {
        entry: "electron/main.ts",
        // The plugin launches Electron with `--no-sandbox` by default, which
        // would quietly contradict `sandbox: true` in webPreferences and make
        // dev behave differently from a packaged build. Launch it clean.
        onstart: async ({ startup }) => {
          await startup(["."]);
        },
      },
      preload: { input: "electron/preload.ts" },
    })),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
