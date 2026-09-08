/**
 * Electron main process: window lifecycle, application menu, and (from Step 6)
 * all filesystem access. The renderer never touches the disk itself.
 */

import { app, BrowserWindow, Menu, nativeImage, shell, type MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import type { DocumentState, MenuCommand } from "../src/types/bridge.js";
import { promptDiscard, registerFileHandlers } from "./fileHandlers.js";

const isMac = process.platform === "darwin";
const isDev = !app.isPackaged;

/** Set by vite-plugin-electron while `npm run dev` is running. */
const devServerUrl = process.env["VITE_DEV_SERVER_URL"];

let mainWindow: BrowserWindow | null = null;

/**
 * Windows permitted to close despite unsaved work — either because the user
 * chose to discard, or because a save prompted by closing has finished.
 */
const closable = new WeakSet<BrowserWindow>();

/** Latest document state reported by each window's renderer. */
const documentStates = new WeakMap<BrowserWindow, DocumentState>();

function send(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("menu:command", command);
}

function applyDocumentState(window: BrowserWindow, state: DocumentState): void {
  documentStates.set(window, state);

  const shown = state.filePath === null ? state.name : path.basename(state.filePath);
  window.setTitle(`${shown}${state.dirty ? " — Edited" : ""}`);

  if (isMac) {
    // The proxy icon and the dot in the close button are how macOS shows an
    // edited document; Windows conveys it through the title alone.
    window.setRepresentedFilename(state.filePath ?? "");
    window.setDocumentEdited(state.dirty);
  }
}

/**
 * Packaged builds take their icon from the bundle, so this only matters in
 * development, where Electron would otherwise show its own default icon.
 */
function devIconPath(): string | null {
  if (!isDev) return null;
  const candidate = path.join(process.cwd(), "build", "icon.png");
  return existsSync(candidate) ? candidate : null;
}

function createWindow(): BrowserWindow {
  const devIcon = devIconPath();
  const window = new BrowserWindow({
    // Windows and Linux read the window/taskbar icon from here; macOS uses the
    // dock icon set below instead.
    ...(devIcon ? { icon: devIcon } : {}),
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    // Native title bar on both platforms: custom chrome would mean traffic
    // lights on macOS versus min/max/close on Windows, for no MVP benefit.
    show: false,
    backgroundColor: "#1a1a1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Avoids the white flash before React has painted.
  window.once("ready-to-show", () => window.show());

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // The app is fully offline: nothing should ever navigate or open a new
  // window. Anything that tries is a bug or an injection attempt, so send real
  // links to the user's browser and refuse the rest.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return;
    event.preventDefault();
  });

  // Never let unsaved work disappear because a window was closed (spec
  // section 8). The prompt is native, and the renderer does the saving.
  window.on("close", (event) => {
    if (closable.has(window)) return;
    if (documentStates.get(window)?.dirty !== true) return;

    event.preventDefault();
    void (async () => {
      const state = documentStates.get(window);
      const name = state?.filePath === null || state?.filePath === undefined
        ? (state?.name ?? "this document")
        : path.basename(state.filePath);

      const choice = await promptDiscard(window, name);
      if (choice === "cancel") return;
      if (choice === "discard") {
        closable.add(window);
        window.close();
        return;
      }
      // "Save": the renderer saves, then calls back through
      // `document:allow-close`, which closes the window for real.
      window.webContents.send("menu:command", "save-and-close");
    })();
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  return window;
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    // macOS expects a leading submenu named after the app; Windows has no
    // equivalent. One template, one conditional entry — never a forked menu.
    ...(isMac
      ? ([{ role: "appMenu" }] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: "&File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: () => send("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => send("open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send("save") },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => send("save-as"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "&View",
      submenu: [
        ...(isDev
          ? ([{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }] satisfies MenuItemConstructorOptions[])
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// A second instance on Windows should focus the existing window rather than
// opening a rival one that could write over the same document.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  registerFileHandlers({
    onDocumentState: applyDocumentState,
    onAllowClose: (window) => {
      closable.add(window);
      window.close();
    },
  });

  void app.whenReady().then(() => {
    const devIcon = devIconPath();
    if (devIcon && isMac && app.dock) {
      app.dock.setIcon(nativeImage.createFromPath(devIcon));
    }

    buildMenu();
    mainWindow = createWindow();

    // macOS keeps the app running with no windows; clicking the dock icon
    // must be able to bring one back.
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  // On Windows and Linux, closing the last window quits. On macOS it does not.
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
}
