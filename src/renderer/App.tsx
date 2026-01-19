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

function App() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <ChatProvider>
          <div className="skilljack-app">
            {/* In Electron mode, the drawer is always visible as the main UI */}
            <ChatDrawer alwaysOpen />
          </div>
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
