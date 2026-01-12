/**
 * Chat Drawer Entry Point
 *
 * Mounts the React chat drawer into the existing vanilla JS app.
 * This builds as an IIFE bundle that self-initializes on load.
 */

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatProvider, useChat } from './context/ChatContext';
import { ThemeProvider } from './context/ThemeContext';
import { SettingsProvider } from '../settings';
import { ChatDrawer } from './components/ChatDrawer';
import './main.css';

// Component that exposes toggle to window
function ChatBridge() {
  const { toggleDrawer } = useChat();

  useEffect(() => {
    // Expose toggle function to window for header button
    (window as unknown as { toggleChat: () => void }).toggleChat = toggleDrawer;
    console.log('[Chat] Ready - press Ctrl+K or click Chat button');
    return () => {
      delete (window as unknown as { toggleChat?: () => void }).toggleChat;
    };
  }, [toggleDrawer]);

  return <ChatDrawer />;
}

function App() {
  return (
    <StrictMode>
      <ThemeProvider>
        <SettingsProvider>
          <ChatProvider>
            <ChatBridge />
          </ChatProvider>
        </SettingsProvider>
      </ThemeProvider>
    </StrictMode>
  );
}

// Mount when DOM is ready
function mount() {
  const container = document.getElementById('chat-root');
  if (container) {
    const root = createRoot(container);
    root.render(<App />);
    console.log('[Chat] Mounted');
  } else {
    console.error('[Chat] Could not find #chat-root element');
  }
}

// Auto-mount
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
