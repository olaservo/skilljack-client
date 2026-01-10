/**
 * Sandbox Proxy Server
 *
 * A minimal HTTP server on a DIFFERENT port (different origin) that serves
 * the sandbox proxy HTML. This is required for the double-iframe security
 * model used by MCP Apps.
 */

import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Static files are in src/web/static, not dist/web/static
function getStaticDir(): string {
  const currentDir = __dirname;
  if (currentDir.includes('dist')) {
    return join(currentDir, '..', '..', 'src', 'web', 'static');
  }
  return join(currentDir, 'static');
}

export interface SandboxServerConfig {
  port: number;
  allowedHost: string; // e.g., 'localhost:8080'
  onLog?: (message: string) => void;
}

export async function startSandboxServer(config: SandboxServerConfig): Promise<{
  close: () => void;
}> {
  const { port, allowedHost, onLog } = config;
  const log = onLog || console.log;

  const sandboxHtmlPath = join(getStaticDir(), 'sandbox.html');
  let sandboxHtml: string;

  try {
    sandboxHtml = await readFile(sandboxHtmlPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read sandbox.html from ${sandboxHtmlPath}`);
  }

  const server = createServer((req, res: ServerResponse) => {
    // Validate referrer - only allow embedding from the main host
    const referer = req.headers.referer || req.headers.origin || '';
    const allowedOrigin = `http://${allowedHost}`;

    if (referer && !referer.startsWith(allowedOrigin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Invalid referrer');
      return;
    }

    // Only serve sandbox.html
    if (req.url === '/' || req.url === '/sandbox.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'X-Frame-Options': 'ALLOWALL', // Allow embedding
      });
      res.end(sandboxHtml);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      log(`[Sandbox] Proxy server running at http://localhost:${port}`);
      resolve({
        close: () => server.close(),
      });
    });
  });
}
