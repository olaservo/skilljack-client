/**
 * Browser-side MCP Apps Client
 *
 * Manages connection status and MCP App iframe embedding.
 * Supports multiple app panels with configurable layout modes.
 * Tool interaction is handled via the chat drawer.
 */

// State
let config = null;
let tools = [];
let ws = null;

// Multi-panel state
const appPanels = new Map();  // Map<key, AppPanel>
let layoutMode = 'grid';      // 'grid' | 'tabs' | 'stack'
let activeTabKey = null;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const appContainer = document.getElementById('app-container');
const appPanelsContainer = document.getElementById('app-panels');
const layoutControls = document.getElementById('layout-controls');
const appTabs = document.getElementById('app-tabs');

// Initialize
async function init() {
  try {
    // Fetch config (sandbox port, multi-server info)
    const configRes = await fetch('/api/config');
    config = await configRes.json();

    // Fetch tools (for chat context)
    const toolsRes = await fetch('/api/tools');
    const data = await toolsRes.json();
    tools = data.tools;

    // Connect WebSocket for real-time updates
    connectWebSocket();

    // Initialize layout controls
    initLayoutControls();

    connectionStatus.textContent = config.multiServer
      ? `Connected (${config.serverCount} servers)`
      : 'Connected';
    connectionStatus.className = 'connected';
  } catch (error) {
    connectionStatus.textContent = 'Connection Error';
    connectionStatus.className = 'disconnected';
    console.error('Init error:', error);
  }
}

// Initialize layout control buttons
function initLayoutControls() {
  const buttons = layoutControls.querySelectorAll('button[data-layout]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      setLayoutMode(btn.dataset.layout);
    });
  });
}

// Set layout mode (grid, tabs, stack)
function setLayoutMode(mode) {
  layoutMode = mode;
  appContainer.dataset.layout = mode;

  // Update button states
  const buttons = layoutControls.querySelectorAll('button[data-layout]');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === mode);
  });

  // Show/hide tab bar
  appTabs.classList.toggle('hidden', mode !== 'tabs');

  // In tabs mode, ensure one panel is active
  if (mode === 'tabs' && appPanels.size > 0) {
    if (!activeTabKey || !appPanels.has(activeTabKey)) {
      activeTabKey = appPanels.keys().next().value;
    }
    setActiveTab(activeTabKey);
  }
}

// Set active tab (for tabs mode)
function setActiveTab(key) {
  activeTabKey = key;

  // Update tab buttons
  document.querySelectorAll('.app-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.key === key);
  });

  // Update panel visibility
  document.querySelectorAll('.app-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.key === key);
  });
}

// Update UI state based on panel count
function updateUIState() {
  const hasApps = appPanels.size > 0;
  appContainer.classList.toggle('has-app', hasApps);
  layoutControls.classList.toggle('hidden', !hasApps);
  appTabs.classList.toggle('hidden', layoutMode !== 'tabs' || !hasApps);
}

// Create a tab button for a panel
function createTab(key, toolName, serverName) {
  const tab = document.createElement('button');
  tab.className = 'app-tab';
  tab.dataset.key = key;

  const label = document.createElement('span');
  label.textContent = `${toolName} (${serverName})`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'app-tab-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePanel(key);
  });

  tab.appendChild(label);
  tab.appendChild(closeBtn);
  tab.addEventListener('click', () => setActiveTab(key));

  appTabs.appendChild(tab);
}

// Close a panel by key
function closePanel(key) {
  const panel = appPanels.get(key);
  if (!panel) return;

  // Cleanup iframe event listeners
  if (panel.cleanup) {
    panel.cleanup();
  }

  // Remove DOM elements
  panel.wrapper.remove();

  // Remove tab if exists
  const tab = document.querySelector(`.app-tab[data-key="${key}"]`);
  if (tab) tab.remove();

  // Remove from map
  appPanels.delete(key);

  // If this was the active tab, switch to another
  if (layoutMode === 'tabs' && activeTabKey === key) {
    const nextKey = appPanels.keys().next().value || null;
    if (nextKey) {
      setActiveTab(nextKey);
    } else {
      activeTabKey = null;
    }
  }

  // Update UI state
  updateUIState();
}

// Create a new panel
async function createNewPanel(key, serverName, uiResourceUri, toolInput, toolResult) {
  // Fetch UI resource
  const uriPath = config?.multiServer
    ? `${encodeURIComponent(serverName)}/${encodeURIComponent(uiResourceUri)}`
    : encodeURIComponent(uiResourceUri);

  const res = await fetch(`/api/ui-resource/${uriPath}`);
  if (!res.ok) throw new Error('Failed to fetch UI resource');
  const uiResource = await res.json();

  // Extract tool name for display
  const toolName = uiResourceUri.split('/').pop() || uiResourceUri;

  // Create panel wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'app-panel';
  wrapper.dataset.key = key;

  // Create header
  const header = document.createElement('div');
  header.className = 'panel-header';

  const title = document.createElement('span');
  title.className = 'panel-title';
  title.textContent = `${toolName} (${serverName})`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'panel-close';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => closePanel(key));

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Create content area
  const content = document.createElement('div');
  content.className = 'panel-content';

  // Create iframe
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  iframe.src = `http://localhost:${config.sandboxPort}/sandbox.html`;

  content.appendChild(iframe);
  wrapper.appendChild(header);
  wrapper.appendChild(content);

  // Add to panels container
  appPanelsContainer.appendChild(wrapper);

  // Wait for sandbox ready
  await waitForSandboxReady(iframe);

  // Set up message bridge (returns cleanup function)
  const cleanup = setupAppBridge(iframe, uiResource, toolInput, toolResult);

  // Store panel info (including sendCancellation for v0.4.1)
  appPanels.set(key, {
    key,
    iframe,
    wrapper,
    serverName,
    toolName,
    uiResourceUri,
    cleanup,
    // v0.4.1: Method to send tool cancellation notification
    sendCancellation: (reason = 'User cancelled') => {
      sendToApp(iframe, {
        jsonrpc: '2.0',
        method: 'ui/toolCancelled',
        params: { reason },
      });
    },
  });

  // Create tab if in tabs mode
  if (layoutMode === 'tabs') {
    createTab(key, toolName, serverName);
    setActiveTab(key);
  }

  // Update UI state
  updateUIState();
}

// Update existing panel with new data
function updateExistingPanel(panel, toolInput, toolResult) {
  sendToApp(panel.iframe, {
    jsonrpc: '2.0',
    method: 'ui/toolInput',
    params: { arguments: toolInput },
  });

  sendToApp(panel.iframe, {
    jsonrpc: '2.0',
    method: 'ui/toolResult',
    params: toolResult,
  });
}

// Expose loadMcpApp globally for chat to use
window.loadMcpApp = async function(serverName, uiResourceUri, toolInput, toolResult) {
  try {
    // Generate key from qualified tool name
    const key = `${serverName}__${uiResourceUri}`;

    // Check if panel already exists for this tool
    const existingPanel = appPanels.get(key);

    if (existingPanel) {
      // REPLACE: Update existing panel with new data
      updateExistingPanel(existingPanel, toolInput, toolResult);

      // If in tabs mode, switch to this panel
      if (layoutMode === 'tabs') {
        setActiveTab(key);
      }
    } else {
      // ADD: Create new panel
      await createNewPanel(key, serverName, uiResourceUri, toolInput, toolResult);
    }
  } catch (error) {
    console.error('Failed to load MCP App:', error);
  }
};

window.clearMcpApp = function() {
  // Close all panels
  for (const key of [...appPanels.keys()]) {
    closePanel(key);
  }
};

// v0.4.1: Send tool cancellation notification to a specific app panel
window.cancelMcpAppTool = function(serverName, uiResourceUri, reason = 'User cancelled') {
  const key = `${serverName}__${uiResourceUri}`;
  const panel = appPanels.get(key);
  if (panel?.sendCancellation) {
    panel.sendCancellation(reason);
    console.log('[Host] Sent tool cancellation to:', key);
    return true;
  }
  return false;
};

// v0.4.1: Send tool cancellation to all active app panels
window.cancelAllMcpAppTools = function(reason = 'User cancelled') {
  for (const panel of appPanels.values()) {
    if (panel.sendCancellation) {
      panel.sendCancellation(reason);
    }
  }
  console.log('[Host] Sent tool cancellation to all panels');
};

function waitForSandboxReady(iframe) {
  return new Promise((resolve) => {
    const handler = (event) => {
      if (event.source === iframe.contentWindow &&
          event.data?.method === 'ui/notifications/sandbox-proxy-ready') {
        window.removeEventListener('message', handler);
        resolve();
      }
    };
    window.addEventListener('message', handler);
  });
}

function setupAppBridge(iframe, uiResource, toolInput, toolResult) {
  let appInitialized = false;
  let currentDisplayMode = 'inline';

  // Extract tool name from uiResource for toolInfo
  const toolName = uiResource.uri?.split('/').pop() || uiResource.serverName || 'unknown';

  // Helper to get current theme (checks for dark mode preference or class)
  function getCurrentTheme() {
    if (document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  // Helper to extract CSS variables from the document
  function getCssVariables() {
    const styles = getComputedStyle(document.documentElement);
    const variables = {};
    // Extract common theme variables
    const varNames = [
      '--primary-color', '--secondary-color', '--background', '--foreground',
      '--text-color', '--border-color', '--accent-color', '--error-color',
      '--success-color', '--warning-color', '--muted-color'
    ];
    for (const name of varNames) {
      const value = styles.getPropertyValue(name).trim();
      if (value) {
        variables[name] = value;
      }
    }
    return variables;
  }

  // Build enhanced host context (v0.4.1)
  function buildHostContext() {
    return {
      theme: getCurrentTheme(),
      locale: navigator.language,
      toolInfo: {
        name: toolName,
        arguments: toolInput,
      },
      availableDisplayModes: ['inline', 'fullscreen'],
      styles: {
        variables: getCssVariables(),
        css: {},
      },
    };
  }

  const messageHandler = async (event) => {
    if (event.source !== iframe.contentWindow) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Handle JSON-RPC messages from app
    if (data.jsonrpc === '2.0') {
      // App sends ui/initialize request - HOST MUST RESPOND (v0.4.1 enhanced)
      if (data.method === 'ui/initialize' && data.id) {
        console.log('[Host] Received ui/initialize from app:', data.params);
        sendToApp(iframe, {
          jsonrpc: '2.0',
          id: data.id,
          result: {
            protocolVersion: '2025-01-01',
            hostCapabilities: {
              tools: {},
              resources: {},
            },
            hostInfo: {
              name: 'skilljack-web',
              version: '0.2.0',
            },
            hostContext: buildHostContext(),
          },
        });
      }

      // App initialized notification - now we can send tool data
      if (data.method === 'ui/notifications/initialized') {
        console.log('[Host] App initialized');
        appInitialized = true;

        // Send tool input
        sendToApp(iframe, {
          jsonrpc: '2.0',
          method: 'ui/toolInput',
          params: { arguments: toolInput },
        });

        // Send tool result
        sendToApp(iframe, {
          jsonrpc: '2.0',
          method: 'ui/toolResult',
          params: toolResult,
        });
      }

      // App requests to call a tool (MCP standard method)
      if (data.method === 'tools/call' && data.id) {
        try {
          // Qualify tool name with server name if not already qualified
          let toolName = data.params.name;
          if (!toolName.includes('__') && uiResource.serverName) {
            toolName = `${uiResource.serverName}__${toolName}`;
          }

          console.log('[Host] Calling tool:', toolName);
          const result = await fetch(`/api/tools/${encodeURIComponent(toolName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data.params.arguments || {}),
          });
          const callResult = await result.json();

          // Check for API error response
          if (!result.ok || callResult.error) {
            const errorMessage = callResult.error || `HTTP ${result.status}`;
            console.error('[Host] Tool call error:', errorMessage);
            sendToApp(iframe, {
              jsonrpc: '2.0',
              id: data.id,
              error: { code: -32603, message: errorMessage },
            });
          } else {
            console.log('[Host] Tool call success');
            sendToApp(iframe, {
              jsonrpc: '2.0',
              id: data.id,
              result: callResult,
            });
          }
        } catch (error) {
          console.error('[Host] Tool call exception:', error);
          sendToApp(iframe, {
            jsonrpc: '2.0',
            id: data.id,
            error: { code: -1, message: error.message },
          });
        }
      }

      // App sends a message
      if (data.method === 'ui/message' && data.id) {
        console.log('[Host] Message from app:', data.params);
        sendToApp(iframe, {
          jsonrpc: '2.0',
          id: data.id,
          result: {},
        });
      }

      // App requests to open a link
      if (data.method === 'ui/openLink' && data.id) {
        window.open(data.params.url, '_blank', 'noopener,noreferrer');
        sendToApp(iframe, {
          jsonrpc: '2.0',
          id: data.id,
          result: {},
        });
      }

      // App sends a log message
      if (data.method === 'ui/notifications/loggingMessage') {
        console.log(`[App ${data.params.level}]`, data.params.data);
      }

      // App sends size change notification - handle per-panel
      if (data.method === 'ui/notifications/size-changed') {
        const { width, height } = data.params;
        console.log('[Host] Size change:', width, 'x', height);
        // Find the panel content wrapper for this iframe
        const panelContent = iframe.closest('.app-panel')?.querySelector('.panel-content');
        if (panelContent && height && height > 0) {
          panelContent.style.minHeight = `${height}px`;
        }
      }

      // Legacy: App requests size change (request form)
      if (data.method === 'ui/sizeChanged' && data.id) {
        const { width, height } = data.params;
        console.log('[Host] Size change requested:', width, 'x', height);
        const panelContent = iframe.closest('.app-panel')?.querySelector('.panel-content');
        if (panelContent && height && height > 0) {
          panelContent.style.minHeight = `${height}px`;
        }
        sendToApp(iframe, {
          jsonrpc: '2.0',
          id: data.id,
          result: {},
        });
      }

      // v0.4.1: App requests display mode change (fullscreen, pip, inline)
      if (data.method === 'ui/requestDisplayMode' && data.id) {
        const { mode } = data.params;
        console.log('[Host] Display mode requested:', mode);

        const panel = iframe.closest('.app-panel');
        if (panel) {
          // Remove existing mode classes
          panel.classList.remove('display-mode-fullscreen', 'display-mode-pip', 'display-mode-inline');

          if (mode === 'fullscreen') {
            panel.classList.add('display-mode-fullscreen');
            currentDisplayMode = 'fullscreen';
          } else if (mode === 'pip') {
            // PiP not fully supported yet, fall back to inline
            console.log('[Host] PiP mode not supported, using inline');
            panel.classList.add('display-mode-inline');
            currentDisplayMode = 'inline';
          } else {
            panel.classList.add('display-mode-inline');
            currentDisplayMode = 'inline';
          }
        }

        sendToApp(iframe, {
          jsonrpc: '2.0',
          id: data.id,
          result: { mode: currentDisplayMode },
        });
      }

      // v0.4.1: App updates model context
      if (data.method === 'ui/modelContext' && data.id) {
        const { content, structuredContent } = data.params;
        console.log('[Host] Model context update:', { content, structuredContent });

        // Store the model context for potential use in chat/LLM context
        // This could be forwarded to the chat context manager in a full implementation
        if (window.onModelContextUpdate) {
          window.onModelContextUpdate({
            toolName,
            content,
            structuredContent,
          });
        }

        sendToApp(iframe, {
          jsonrpc: '2.0',
          id: data.id,
          result: {},
        });
      }
    }
  };

  window.addEventListener('message', messageHandler);

  // Inject host origin into HTML so apps can make API calls back to host
  // UI resources return HTML in 'text' property (per MCP resource format)
  let html = uiResource.text || uiResource.html;
  if (!html) {
    console.error('[Host] UI resource has no HTML content:', uiResource);
    return () => window.removeEventListener('message', messageHandler);
  }
  const hostOriginScript = `<script>window.__HOST_ORIGIN__ = "${window.location.origin}";</script>`;
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>${hostOriginScript}`);
  } else {
    html = hostOriginScript + html;
  }

  // Send HTML to sandbox - app will load, call connect(), and send ui/initialize
  console.log('[Host] Sending sandbox-resource-ready with HTML...');
  sendToApp(iframe, {
    jsonrpc: '2.0',
    method: 'ui/notifications/sandbox-resource-ready',
    params: {
      html,
      csp: uiResource.csp,
    },
  });

  // Return cleanup function
  return () => {
    window.removeEventListener('message', messageHandler);
  };
}

function sendToApp(iframe, message) {
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage(message, '*');
  }
}

// WebSocket for real-time updates
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    console.log('[WS] Connected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'tools_changed') {
        console.log('[WS] Tools changed');
        // Could trigger a refresh in chat context here
      }
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 3s...');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error('[WS] Error:', error);
  };
}

// Start
init();
