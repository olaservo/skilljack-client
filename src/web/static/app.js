/**
 * Browser-side MCP Apps Client
 *
 * Handles tool list display, tool calling, and MCP App iframe management.
 * Supports both single-server and multi-server modes.
 */

// State
let config = null;
let tools = [];
let selectedTool = null;
let currentIframe = null;
let ws = null;
let servers = [];

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const serverInfo = document.getElementById('server-info');
const toolsList = document.getElementById('tools-list');
const selectedToolName = document.getElementById('selected-tool-name');
const toolDescription = document.getElementById('tool-description');
const toolArgs = document.getElementById('tool-args');
const callButton = document.getElementById('call-button');
const resultJson = document.getElementById('result-json');
const appContainer = document.getElementById('app-container');
const appIframeWrapper = document.getElementById('app-iframe-wrapper');

// Initialize
async function init() {
  try {
    // Fetch config (sandbox port, multi-server info)
    const configRes = await fetch('/api/config');
    config = await configRes.json();

    // Fetch server(s) info
    if (config.multiServer) {
      const serversRes = await fetch('/api/servers');
      const data = await serversRes.json();
      servers = data.servers;
      serverInfo.innerHTML = servers.map(s =>
        `<strong>${s.name}</strong> (${s.toolCount} tools)`
      ).join(' | ');
    } else {
      const serverRes = await fetch('/api/server');
      const server = await serverRes.json();
      serverInfo.innerHTML = `<strong>${server.serverVersion?.name || 'Unknown'}</strong> v${server.serverVersion?.version || '?'}`;
    }

    // Fetch tools
    await refreshTools();

    // Connect WebSocket for real-time updates
    connectWebSocket();

    connectionStatus.textContent = config.multiServer
      ? `Connected (${config.serverCount} servers)`
      : 'Connected';
    connectionStatus.className = 'connected';
  } catch (error) {
    connectionStatus.textContent = 'Connection Error';
    connectionStatus.className = 'disconnected';
    serverInfo.innerHTML = `<span class="error">Error: ${error.message}</span>`;
  }
}

async function refreshTools() {
  const toolsRes = await fetch('/api/tools');
  const data = await toolsRes.json();
  tools = data.tools;
  renderToolsList();
}

function renderToolsList() {
  toolsList.innerHTML = '';

  if (tools.length === 0) {
    toolsList.innerHTML = '<li class="loading">No tools available</li>';
    return;
  }

  // Group by server if multi-server mode
  if (config?.multiServer) {
    const grouped = {};
    for (const tool of tools) {
      const server = tool.serverName || 'default';
      if (!grouped[server]) grouped[server] = [];
      grouped[server].push(tool);
    }

    for (const [serverName, serverTools] of Object.entries(grouped)) {
      // Server header
      const header = document.createElement('li');
      header.className = 'server-header';
      header.textContent = serverName;
      toolsList.appendChild(header);

      // Tools for this server
      for (const tool of serverTools) {
        toolsList.appendChild(createToolListItem(tool));
      }
    }
  } else {
    for (const tool of tools) {
      toolsList.appendChild(createToolListItem(tool));
    }
  }
}

function createToolListItem(tool) {
  const li = document.createElement('li');
  li.dataset.tool = tool.name;
  li.dataset.server = tool.serverName || 'default';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tool-name';
  nameSpan.textContent = tool.name;
  li.appendChild(nameSpan);

  const badges = document.createElement('span');
  badges.className = 'tool-badges';

  if (tool.hasUi) {
    const uiBadge = document.createElement('span');
    uiBadge.className = 'ui-badge';
    uiBadge.textContent = 'UI';
    badges.appendChild(uiBadge);
  }

  li.appendChild(badges);
  li.addEventListener('click', () => selectTool(tool));
  return li;
}

function selectTool(tool) {
  selectedTool = tool;

  // Update UI
  document.querySelectorAll('#tools-list li:not(.server-header)').forEach(li => {
    li.classList.toggle('selected',
      li.dataset.tool === tool.name && li.dataset.server === (tool.serverName || 'default'));
  });

  const serverLabel = config?.multiServer ? ` (${tool.serverName})` : '';
  selectedToolName.textContent = tool.name + serverLabel;
  toolDescription.textContent = tool.description || 'No description available.';
  callButton.disabled = false;

  // Reset result and app container
  resultJson.textContent = '';
  appContainer.classList.remove('visible');
  clearAppIframe();
}

async function callTool() {
  if (!selectedTool) return;

  callButton.disabled = true;
  resultJson.textContent = 'Calling tool...';
  appContainer.classList.remove('visible');
  clearAppIframe();

  try {
    let args = {};
    try {
      args = JSON.parse(toolArgs.value || '{}');
    } catch {
      throw new Error('Invalid JSON in arguments');
    }

    // Call the tool
    const response = await fetch(`/api/tools/${encodeURIComponent(selectedTool.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });

    const result = await response.json();
    resultJson.textContent = JSON.stringify(result, null, 2);

    // If tool has UI, load the app
    if (selectedTool.hasUi && selectedTool.uiResourceUri) {
      const serverName = selectedTool.serverName || 'default';
      await loadMcpApp(serverName, selectedTool.uiResourceUri, args, result);
    }
  } catch (error) {
    resultJson.innerHTML = `<span class="error">Error: ${error.message}</span>`;
  } finally {
    callButton.disabled = false;
  }
}

// MCP App Loading
async function loadMcpApp(serverName, uiResourceUri, toolInput, toolResult) {
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
    appContainer.classList.add('visible');

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
    appContainer.classList.remove('visible');
  }
}

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
        // Respond with host capabilities
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

function clearAppIframe() {
  if (currentIframe && currentIframe._cleanup) {
    currentIframe._cleanup();
  }
  appIframeWrapper.innerHTML = '';
  currentIframe = null;
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
        console.log('[WS] Tools changed, refreshing...');
        refreshTools();
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

// Event Listeners
callButton.addEventListener('click', callTool);
toolArgs.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    callTool();
  }
});

// Start
init();
