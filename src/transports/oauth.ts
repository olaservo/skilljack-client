/**
 * OAuth Provider for CLI Applications
 *
 * Handles the OAuth 2.0 authorization code flow for terminal apps:
 * 1. Opens browser for user authorization
 * 2. Starts local callback server to receive auth code
 * 3. Exchanges code for tokens
 * 4. Persists tokens for future use
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { exec } from 'node:child_process';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformationFull,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export interface OAuthConfig {
  /** Path to store tokens */
  tokenFile: string;
  /** Port for callback server */
  callbackPort?: number;
  /** Client name */
  clientName?: string;
}

interface StoredAuth {
  clientInfo?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

/**
 * OAuth provider for CLI applications that need browser-based authorization.
 *
 * The OAuth flow for CLI apps works as follows:
 * 1. Client attempts to connect, gets 401
 * 2. SDK calls redirectToAuthorization() which opens the browser
 * 3. SDK throws UnauthorizedError (redirect happened)
 * 4. We catch the error, wait for callback, get auth code
 * 5. We call transport.finishAuth(code)
 * 6. We retry the connection
 */
export class CliOAuthProvider implements OAuthClientProvider {
  private config: Required<OAuthConfig>;
  private storedAuth: StoredAuth = {};
  private callbackServer: Server | null = null;
  private pendingAuthCode: Promise<string> | null = null;
  private pendingAuthResolve: ((code: string) => void) | null = null;
  private pendingAuthReject: ((error: Error) => void) | null = null;

  constructor(config: OAuthConfig) {
    this.config = {
      tokenFile: config.tokenFile,
      callbackPort: config.callbackPort ?? 8787,
      clientName: config.clientName ?? 'mcp-skilljack-client',
    };
  }

  get redirectUrl(): string {
    return `http://localhost:${this.config.callbackPort}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.config.clientName,
      redirect_uris: [new URL(this.redirectUrl)] as unknown as string[],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
    };
  }

  async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
    await this.loadStoredAuth();
    return this.storedAuth.clientInfo;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    this.storedAuth.clientInfo = info;
    await this.saveStoredAuth();
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    await this.loadStoredAuth();
    return this.storedAuth.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.storedAuth.tokens = tokens;
    await this.saveStoredAuth();
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    this.storedAuth.codeVerifier = verifier;
    await this.saveStoredAuth();
  }

  async codeVerifier(): Promise<string> {
    await this.loadStoredAuth();
    if (!this.storedAuth.codeVerifier) {
      throw new Error('No code verifier stored');
    }
    return this.storedAuth.codeVerifier;
  }

  /**
   * Opens the browser for authorization.
   * This method returns immediately - it doesn't wait for the callback.
   * The callback server is started and will resolve pendingAuthCode when received.
   */
  async redirectToAuthorization(authUrl: URL): Promise<void> {
    console.log('\n[OAuth] Authorization required. Opening browser...\n');
    console.log(`If the browser doesn't open, visit:\n${authUrl.toString()}\n`);

    // Start callback server before opening browser
    this.startCallbackServer();

    // Open browser
    this.openBrowser(authUrl.toString());
  }

  /**
   * Wait for the authorization callback to be received.
   * Call this after catching UnauthorizedError.
   */
  waitForAuthCode(): Promise<string> {
    if (!this.pendingAuthCode) {
      return Promise.reject(new Error('No pending authorization'));
    }
    return this.pendingAuthCode;
  }

  /**
   * Starts a local HTTP server to receive the OAuth callback.
   */
  private startCallbackServer(): void {
    if (this.callbackServer) {
      return; // Already running
    }

    // Create the promise that will be resolved when we get the callback
    this.pendingAuthCode = new Promise<string>((resolve, reject) => {
      this.pendingAuthResolve = resolve;
      this.pendingAuthReject = reject;
    });

    this.callbackServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${this.config.callbackPort}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
          this.stopCallbackServer();
          this.pendingAuthReject?.(new Error(`OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);
          console.log('[OAuth] Authorization code received!\n');
          this.stopCallbackServer();
          this.pendingAuthResolve?.(code);
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.callbackServer.listen(this.config.callbackPort, () => {
      // Server started
    });

    this.callbackServer.on('error', (err) => {
      this.pendingAuthReject?.(new Error(`Callback server error: ${err.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (this.callbackServer) {
        this.stopCallbackServer();
        this.pendingAuthReject?.(new Error('Authorization timed out'));
      }
    }, 5 * 60 * 1000);
  }

  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
    }
  }

  private openBrowser(url: string): void {
    const platform = process.platform;
    let cmd: string;

    if (platform === 'win32') {
      cmd = `start "" "${url}"`;
    } else if (platform === 'darwin') {
      cmd = `open "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }

    exec(cmd, (error) => {
      if (error) {
        console.log(`[OAuth] Could not open browser automatically: ${error.message}`);
      }
    });
  }

  private async loadStoredAuth(): Promise<void> {
    try {
      const data = await readFile(this.config.tokenFile, 'utf-8');
      this.storedAuth = JSON.parse(data);
    } catch {
      // File doesn't exist yet
      this.storedAuth = {};
    }
  }

  private async saveStoredAuth(): Promise<void> {
    await mkdir(dirname(this.config.tokenFile), { recursive: true });
    await writeFile(this.config.tokenFile, JSON.stringify(this.storedAuth, null, 2));
  }
}

/**
 * Create an HTTP transport with OAuth authentication.
 */
export function createOAuthHttpTransport(
  url: string,
  tokenFile: string,
  clientName?: string
) {
  // Dynamically import to avoid circular dependencies
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const authProvider = new CliOAuthProvider({
    tokenFile,
    clientName,
  });

  return new StreamableHTTPClientTransport(new URL(url), { authProvider });
}
