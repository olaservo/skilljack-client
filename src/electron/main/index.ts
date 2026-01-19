/**
 * Electron Main Process Entry Point
 *
 * Creates the BrowserWindow with secure defaults and loads the renderer.
 * Handles IPC communication between renderer and MCP server management.
 */

// Load environment variables from .env file
import 'dotenv/config';

import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import log from 'electron-log';
import { setupIPCHandlers, cleanupIPCHandlers } from './ipc-handlers.js';
import { ServerManager } from './server-manager.js';

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Note: electron-squirrel-startup handling is done by Electron Forge
// during Windows installation. Not needed in the main process code.

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let serverManager: ServerManager | null = null;

// Declare __dirname for ESM compatibility (set by Vite)
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const createWindow = async (): Promise<void> => {
  // Initialize server manager
  serverManager = new ServerManager();
  await serverManager.initialize();

  // Create the browser window with secure defaults
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,     // Required for security
      sandbox: false,             // Disabled temporarily for debugging IPC issue
      nodeIntegration: false,     // Required for security
      webSecurity: true,
    },
    show: false, // Don't show until ready
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1a1a2e',
  });

  // Setup IPC handlers with server manager
  setupIPCHandlers(mainWindow, serverManager);

  // Load the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // Development: load from Vite dev server
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load from bundled files
    await mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Clean up on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  await createWindow();

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up before quit
app.on('before-quit', async () => {
  log.info('Application quitting, cleaning up...');
  cleanupIPCHandlers();
  if (serverManager) {
    await serverManager.shutdown();
    serverManager = null;
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason);
});
