/**
 * Browser-side MCP Apps Client
 *
 * Manages connection status and MCP App iframe embedding.
 * Tool interaction is handled via the chat drawer.
 */

// State
let config = null;
let tools = [];
let currentIframe = null;
let ws = null;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const appContainer = document.getElementById('app-container');
const appIframeWrapper = document.getElementById('app-iframe-wrapper');

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

// Expose loadMcpApp globally for chat to use
window.loadMcpApp = async function(serverName, uiResourceUri, toolInput, toolResult) {
  try {
    // Fetch UI resource HTML (include server name for multi-server routing)
    const uriPath = config?.multiServer
      ? `${encodeURIComponent(serverName)}/${encodeURIComponent(uiResourceUri)}`
      : encodeURIComponent(uiResourceUri);

    const res = await fetch(`/api/ui-resource/${uriPath}`);
    if (!res.ok) {
      throw new Error('Failed to fetch UI resource');
    }
    const uiResource = await res.json();

    // Show app container
    appContainer.classList.add('has-app');

    // Create sandbox iframe
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    iframe.src = `http://localhost:${config.sandboxPort}/sandbox.html`;

    // Wait for sandbox proxy to be ready
    const proxyReady = waitForSandboxReady(iframe);

    appIframeWrapper.innerHTML = '';
    appIframeWrapper.appendChild(iframe);
    currentIframe = iframe;

    await proxyReady;

    // Set up message handler for app communication
    setupAppBridge(iframe, uiResource, toolInput, toolResult);
  } catch (error) {
    console.error('Failed to load MCP App:', error);
    appContainer.classList.remove('has-app');
  }
};

window.clearMcpApp = function() {
  if (currentIframe && currentIframe._cleanup) {
    currentIframe._cleanup();
  }
  appIframeWrapper.innerHTML = '';
  currentIframe = null;
  appContainer.classList.remove('has-app');
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

  const messageHandler = async (event) => {
    if (event.source !== iframe.contentWindow) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Handle JSON-RPC messages from app
    if (data.jsonrpc === '2.0') {
      // App sends ui/initialize request - HOST MUST RESPOND
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
              version: '0.1.0',
            },
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
          const result = await fetch(`/api/tools/${encodeURIComponent(data.params.name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data.params.arguments || {}),
          });
          const callResult = await result.json();

          sendToApp(iframe, {
            jsonrpc: '2.0',
            id: data.id,
            result: callResult,
          });
        } catch (error) {
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

      // App requests size change
      if (data.method === 'ui/sizeChanged' && data.id) {
        console.log('[Host] Size change requested:', data.params);
        sendToApp(iframe, {
          jsonrpc: '2.0',
          id: data.id,
          result: {},
        });
      }
    }
  };

  window.addEventListener('message', messageHandler);

  // Send HTML to sandbox - app will load, call connect(), and send ui/initialize
  console.log('[Host] Sending sandbox-resource-ready with HTML...');
  sendToApp(iframe, {
    jsonrpc: '2.0',
    method: 'ui/notifications/sandbox-resource-ready',
    params: {
      html: uiResource.html,
      csp: uiResource.csp,
    },
  });

  // Store cleanup function
  iframe._cleanup = () => {
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
