/**
 * Sandbox Proxy utilities for MCP App iframes in Electron mode
 *
 * Uses the double-iframe security model from MCP Apps architecture:
 * - Outer iframe: Blob URL (different origin), sandbox="allow-scripts allow-same-origin allow-forms"
 * - Inner iframe: srcdoc with app HTML, sandbox="allow-scripts" (NO allow-same-origin)
 *
 * This prevents the app from escaping the sandbox since the inner iframe
 * doesn't have allow-same-origin.
 *
 * This module provides utilities for:
 * - Creating sandbox proxy Blob URLs
 * - Preparing MCP App HTML with CSP injection
 * - Building CSP meta tags for security
 */

/**
 * Sandbox proxy HTML template
 *
 * This creates a double-iframe structure:
 * - Outer iframe (this proxy): Different origin via Blob URL
 * - Inner iframe: Only allow-scripts (no allow-same-origin), uses srcdoc
 */
const SANDBOX_PROXY_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light dark">
  <title>MCP App Sandbox Proxy</title>
  <style>
    html, body { margin: 0; height: 100vh; width: 100vw; }
    body { display: flex; flex-direction: column; }
    * { box-sizing: border-box; }
    iframe { background-color: transparent; border: none; padding: 0; overflow: auto; flex-grow: 1; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <script>
    // Message types
    const RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';
    const PROXY_READY = 'ui/notifications/sandbox-proxy-ready';

    // Create inner iframe for app (NO allow-same-origin for security!)
    const inner = document.createElement('iframe');
    inner.style.cssText = 'width: 100%; height: 100%; border: none;';
    inner.setAttribute('sandbox', 'allow-scripts allow-forms');
    document.body.appendChild(inner);

    // Build CSP meta tag
    function buildCspMetaTag(csp) {
      const resourceDomains = (csp?.resourceDomains || []).join(' ');
      const connectDomains = (csp?.connectDomains || []).join(' ');
      const directives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: " + resourceDomains,
        "style-src 'self' 'unsafe-inline' blob: data: " + resourceDomains,
        "img-src 'self' data: blob: " + resourceDomains,
        "font-src 'self' data: blob: " + resourceDomains,
        "connect-src 'self' " + connectDomains,
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'"
      ].map(d => d.trim());
      return '<meta http-equiv="Content-Security-Policy" content="' + directives.join('; ') + '">';
    }

    // Message relay
    window.addEventListener('message', (event) => {
      // Messages from HOST (parent window)
      if (event.source === window.parent) {
        // Handle resource ready notification (load app HTML)
        if (event.data?.method === RESOURCE_READY) {
          const { html, csp, hostOrigin } = event.data.params;

          if (typeof html === 'string') {
            let modifiedHtml = html;

            // Inject CSP meta tag
            const cspMetaTag = buildCspMetaTag(csp);
            if (modifiedHtml.includes('<head>')) {
              modifiedHtml = modifiedHtml.replace('<head>', '<head>\\n' + cspMetaTag);
            } else {
              modifiedHtml = cspMetaTag + modifiedHtml;
            }

            // Inject host origin script
            const hostScript = '<script>window.__HOST_ORIGIN__ = "' + (hostOrigin || '') + '";<\\/script>';
            if (modifiedHtml.includes('<head>')) {
              modifiedHtml = modifiedHtml.replace('<head>', '<head>' + hostScript);
            } else {
              modifiedHtml = hostScript + modifiedHtml;
            }

            inner.srcdoc = modifiedHtml;
          }
        } else {
          // Relay other messages to inner iframe
          if (inner.contentWindow) {
            inner.contentWindow.postMessage(event.data, '*');
          }
        }
      }
      // Messages from APP (inner iframe)
      else if (event.source === inner.contentWindow) {
        // Relay to host (accept "null" origin from srcdoc iframes)
        window.parent.postMessage(event.data, '*');
      }
    });

    // Signal ready to host
    window.parent.postMessage({ jsonrpc: '2.0', method: PROXY_READY, params: {} }, '*');
  </script>
</body>
</html>`;

/**
 * Create a Blob URL for the sandbox proxy
 * The blob URL gives the proxy a different origin than the host
 */
export function createSandboxProxyUrl(): string {
  const blob = new Blob([SANDBOX_PROXY_HTML], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

/**
 * Build a Content Security Policy meta tag
 */
export function buildCspMetaTag(csp?: {
  resourceDomains?: string[];
  connectDomains?: string[];
}): string {
  const resourceDomains = (csp?.resourceDomains || []).join(' ');
  const connectDomains = (csp?.connectDomains || []).join(' ');

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ];

  return `<meta http-equiv="Content-Security-Policy" content="${directives.join('; ')}">`;
}

/**
 * Prepare MCP App HTML for loading in a sandboxed iframe
 *
 * - ALWAYS injects permissive CSP meta tag (required for inline scripts)
 * - Injects host origin script for API callbacks
 *
 * The CSP meta tag MUST come first in <head> to be applied before any scripts run.
 */
export function prepareAppHtml(
  html: string,
  hostOrigin: string,
  csp?: { resourceDomains?: string[]; connectDomains?: string[] }
): string {
  let modifiedHtml = html;

  // ALWAYS build a permissive CSP for MCP Apps (allows inline scripts)
  // This is required because MCP Apps typically use inline scripts
  const cspMetaTag = buildCspMetaTag(csp);

  // Inject host origin script so apps can reference the host
  const hostOriginScript = `<script>window.__HOST_ORIGIN__ = "${hostOrigin}";</script>`;

  // Inject CSP meta tag FIRST (must come before any scripts)
  if (modifiedHtml.includes('<head>')) {
    modifiedHtml = modifiedHtml.replace('<head>', `<head>\n${cspMetaTag}`);
  } else if (modifiedHtml.includes('<head ')) {
    modifiedHtml = modifiedHtml.replace(/<head[^>]*>/, `$&\n${cspMetaTag}`);
  } else if (modifiedHtml.includes('<!DOCTYPE')) {
    // Insert after DOCTYPE
    modifiedHtml = modifiedHtml.replace(/(<!DOCTYPE[^>]*>)/i, `$1\n<head>${cspMetaTag}</head>`);
  } else {
    // Prepend CSP at the very beginning
    modifiedHtml = `<head>${cspMetaTag}</head>\n${modifiedHtml}`;
  }

  // Inject host origin script after CSP
  if (modifiedHtml.includes('<head>')) {
    modifiedHtml = modifiedHtml.replace('<head>', `<head>${hostOriginScript}`);
  } else if (modifiedHtml.includes('<head ')) {
    modifiedHtml = modifiedHtml.replace(/<head[^>]*>/, `$&${hostOriginScript}`);
  } else {
    modifiedHtml = hostOriginScript + modifiedHtml;
  }

  return modifiedHtml;
}

/**
 * JSON-RPC message types used in MCP App protocol
 */
export const MessageTypes = {
  // Host -> App notifications
  SANDBOX_RESOURCE_READY: 'ui/notifications/sandbox-resource-ready',
  TOOL_INPUT: 'ui/toolInput',
  TOOL_RESULT: 'ui/toolResult',
  TOOL_CANCELLED: 'ui/toolCancelled',
  THEME_CHANGED: 'ui/themeChanged',
  DISPLAY_MODE_CHANGED: 'ui/displayModeChanged',

  // App -> Host requests
  INITIALIZE: 'ui/initialize',
  MESSAGE: 'ui/message',
  OPEN_LINK: 'ui/openLink',
  REQUEST_DISPLAY_MODE: 'ui/requestDisplayMode',
  MODEL_CONTEXT: 'ui/modelContext',
  TOOLS_CALL: 'tools/call',

  // App -> Host notifications
  INITIALIZED: 'ui/notifications/initialized',
  LOGGING_MESSAGE: 'ui/notifications/loggingMessage',
  SIZE_CHANGED: 'ui/notifications/size-changed',
  SANDBOX_PROXY_READY: 'ui/notifications/sandbox-proxy-ready',

  // Legacy
  SIZE_CHANGED_REQUEST: 'ui/sizeChanged',
} as const;

/**
 * Create a JSON-RPC response message
 */
export function createJsonRpcResponse(id: number | string, result: unknown): object {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Create a JSON-RPC error response
 */
export function createJsonRpcError(
  id: number | string,
  code: number,
  message: string
): object {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

/**
 * Create a JSON-RPC notification (no id, no response expected)
 */
export function createJsonRpcNotification(
  method: string,
  params: unknown
): object {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}
