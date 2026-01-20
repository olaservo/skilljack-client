/**
 * Electron Renderer App Entry Point
 *
 * Root component for the Electron desktop application.
 * Wraps the chat UI with necessary providers.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './chat/context/ThemeContext';
import { ChatProvider } from './chat/context/ChatContext';
import { SettingsProvider } from './settings';
import { ChatDrawer } from './chat/components';
import { McpAppProvider, McpAppPanelsContainer } from './mcp-apps';

function App() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <ChatProvider>
          <McpAppProvider>
            <div className="skilljack-app">
              {/* MCP App panels area */}
              <McpAppPanelsContainer />
              {/* In Electron mode, the drawer is always visible as the main UI */}
              <ChatDrawer alwaysOpen />
            </div>
          </McpAppProvider>
        </ChatProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
