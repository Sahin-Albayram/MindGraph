/**
 * Electron main process: window lifecycle, application menu, and (from Step 6)
 * all filesystem access. The renderer never touches the disk itself.
 */

import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";
import path from "node:path";

const isMac = process.platform === "darwin";
const isDev = !app.isPackaged;

/** Set by vite-plugin-electron while `npm run dev` is running. */
const devServerUrl = process.env["VITE_DEV_SERVER_URL"];

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
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
        // File operations arrive in Step 6, alongside the preload bridge.
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

  void app.whenReady().then(() => {
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
