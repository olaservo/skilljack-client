/**
 * Tool call handlers for internal-server-config
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CONFIGURE_SERVERS_NAME,
  LIST_SERVERS_NAME,
  ADD_SERVER_NAME,
  REMOVE_SERVER_NAME,
  RESTART_SERVER_NAME,
  STOP_SERVER_NAME,
  START_SERVER_NAME,
  ENABLE_SERVER_NAME,
  DISABLE_SERVER_NAME,
  INSTALL_MCPB_NAME,
  AddServerSchema,
  RemoveServerSchema,
  RestartServerSchema,
  StopServerSchema,
  StartServerSchema,
  EnableServerSchema,
  DisableServerSchema,
  InstallMcpbSchema,
} from './tools/index.js';

/**
 * Server configuration with status information.
 */
export interface ServerConfigWithStatus {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  status: string;
  enabled: boolean;
  toolCount: number;
  lastError?: string;
}

/**
 * Dependencies required by the server-config handler.
 * These are provided by the host application (e.g., McpManager).
 */
export interface ServerConfigDeps {
  /** Get list of server configs with their current status */
  getServerConfigs(): Promise<ServerConfigWithStatus[]>;

  /** Add a new server configuration */
  addServerConfig(config: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }): Promise<void>;

  /** Remove a server configuration */
  removeServerConfig(name: string): Promise<void>;

  /** Restart a running server */
  restartServer(name: string): Promise<void>;

  /** Stop a running server */
  stopServer(name: string): Promise<void>;

  /** Start a stopped server */
  startServer(name: string): Promise<void>;

  /** Enable or disable a server (controls tool visibility) */
  setServerEnabled(name: string, enabled: boolean): void;

  /** Preview an MCPB file for installation */
  previewMcpb?(mcpbPath: string): Promise<{
    manifest: { name?: string; display_name?: string; version?: string };
    signature: { status: string; publisher?: string };
    platformCompatible: boolean;
    missingRequiredConfig: string[];
    mcpbPath: string;
  }>;

  /** Store preview data for the confirmation UI */
  setPendingMcpbPreview?(preview: unknown): void;
}

/**
 * Result type for handlers, extending CallToolResult with serverName.
 */
export interface HandlerResult extends CallToolResult {
  serverName: string;
}

const SERVER_NAME = 'server-config';

/**
 * Helper to create an error result.
 */
function errorResult(message: string): HandlerResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
        annotations: { audience: ['user', 'assistant'], priority: 1.0 },
      },
    ],
    isError: true,
    serverName: SERVER_NAME,
  };
}

/**
 * Helper to create a success result.
 */
function successResult(message: string, audience: ('user' | 'assistant')[] = ['user']): HandlerResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
        annotations: { audience, priority: 0.7 },
      },
    ],
    serverName: SERVER_NAME,
  };
}

/**
 * Create a handler function for server-config tools.
 * Uses dependency injection to allow the host application to provide implementations.
 *
 * @param deps - Dependencies provided by the host application
 * @returns Handler function that returns a result or null if not handled
 */
export function createServerConfigHandler(deps: ServerConfigDeps) {
  return async (
    toolName: string,
    args: Record<string, unknown>
  ): Promise<HandlerResult | null> => {
    // Handle configure-servers UI tool
    if (toolName === CONFIGURE_SERVERS_NAME) {
      return successResult('Server configuration opened.');
    }

    // Handle list-servers
    if (toolName === LIST_SERVERS_NAME) {
      const servers = await deps.getServerConfigs();
      const summary = servers
        .map(
          (s) =>
            `- **${s.name}**: ${s.status} (${s.toolCount} tools)${
              s.lastError ? ` - Error: ${s.lastError}` : ''
            }`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text:
              servers.length > 0
                ? `## Connected Servers\n\n${summary}`
                : 'No servers configured. Use add-server to add one.',
            annotations: { audience: ['assistant'], priority: 0.7 },
          },
        ],
        serverName: SERVER_NAME,
      };
    }

    // Handle add-server
    if (toolName === ADD_SERVER_NAME) {
      try {
        const validated = AddServerSchema.parse(args);
        await deps.addServerConfig({
          name: validated.name,
          command: validated.command,
          args: validated.args,
          env: validated.env,
        });
        return successResult(`Server "${validated.name}" added and starting...`);
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to add server: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Handle remove-server
    if (toolName === REMOVE_SERVER_NAME) {
      try {
        const validated = RemoveServerSchema.parse(args);
        await deps.removeServerConfig(validated.name);
        return successResult(`Server "${validated.name}" removed.`);
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to remove server: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Handle restart-server
    if (toolName === RESTART_SERVER_NAME) {
      try {
        const validated = RestartServerSchema.parse(args);
        await deps.restartServer(validated.name);
        return successResult(`Server "${validated.name}" is restarting...`);
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to restart server: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Handle stop-server
    if (toolName === STOP_SERVER_NAME) {
      try {
        const validated = StopServerSchema.parse(args);
        await deps.stopServer(validated.name);
        return successResult(`Server "${validated.name}" stopped.`);
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to stop server: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Handle start-server
    if (toolName === START_SERVER_NAME) {
      try {
        const validated = StartServerSchema.parse(args);
        await deps.startServer(validated.name);
        return successResult(`Server "${validated.name}" starting...`);
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to start server: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Handle enable-server
    if (toolName === ENABLE_SERVER_NAME) {
      try {
        const validated = EnableServerSchema.parse(args);
        deps.setServerEnabled(validated.name, true);
        return successResult(
          `Server "${validated.name}" has been enabled. Its tools are now available.`
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to enable server: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Handle disable-server
    if (toolName === DISABLE_SERVER_NAME) {
      try {
        const validated = DisableServerSchema.parse(args);
        deps.setServerEnabled(validated.name, false);
        return successResult(
          `Server "${validated.name}" has been disabled. Its tools are no longer available.`
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to disable server: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Handle install-mcpb
    if (toolName === INSTALL_MCPB_NAME) {
      if (!deps.previewMcpb || !deps.setPendingMcpbPreview) {
        return errorResult('MCPB installation is not supported in this mode.');
      }

      try {
        const validated = InstallMcpbSchema.parse(args);
        const preview = await deps.previewMcpb(validated.mcpbPath);
        deps.setPendingMcpbPreview(preview);

        const displayName = preview.manifest.display_name || preview.manifest.name || 'Unknown';
        const version = preview.manifest.version || 'unknown';

        return successResult(
          `Opening installation dialog for "${displayName}" v${version}...`
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return errorResult(`Invalid arguments: ${err.message}`);
        }
        return errorResult(
          `Failed to preview MCPB: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    // Not handled by this handler
    return null;
  };
}
