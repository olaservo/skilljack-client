/**
 * Server factory for running internal-server-config as a standalone MCP server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ALL_SERVER_CONFIG_TOOLS,
  SERVER_CONFIG_UI_URI,
  MCPB_CONFIRM_UI_URI,
  ConfigureServersSchema,
  ListServersSchema,
  AddServerSchema,
  RemoveServerSchema,
  RestartServerSchema,
  StopServerSchema,
  StartServerSchema,
  EnableServerSchema,
  DisableServerSchema,
  InstallMcpbSchema,
} from './tools/index.js';
import { createServerConfigHandler, type ServerConfigDeps, type ServerConfigWithStatus } from './handlers.js';
import { getServerConfigUI, getMcpbConfirmUI } from './ui/index.js';

export interface ServerFactoryResponse {
  server: McpServer;
  cleanup: () => void;
}

/**
 * In-memory state for standalone server mode.
 * In a real application, this would persist to a file.
 */
interface StandaloneState {
  servers: Map<string, {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    enabled: boolean;
    status: string;
    toolCount: number;
  }>;
}

/**
 * Creates a standalone MCP server for server configuration.
 *
 * Note: In standalone mode, the server config tools demonstrate the
 * interface but cannot actually manage external MCP servers.
 * The state is kept in memory and not persisted.
 */
export function createServer(): ServerFactoryResponse {
  // Initialize in-memory state
  const state: StandaloneState = {
    servers: new Map(),
  };

  // Create dependencies for standalone mode
  const deps: ServerConfigDeps = {
    async getServerConfigs(): Promise<ServerConfigWithStatus[]> {
      return Array.from(state.servers.values()).map((s) => ({
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
        status: s.status,
        enabled: s.enabled,
        toolCount: s.toolCount,
      }));
    },

    async addServerConfig(config) {
      if (state.servers.has(config.name)) {
        throw new Error(`Server "${config.name}" already exists`);
      }
      state.servers.set(config.name, {
        ...config,
        enabled: true,
        status: 'stopped', // In standalone mode, servers aren't actually started
        toolCount: 0,
      });
    },

    async removeServerConfig(name) {
      if (!state.servers.has(name)) {
        throw new Error(`Server "${name}" not found`);
      }
      state.servers.delete(name);
    },

    async restartServer(name) {
      const server = state.servers.get(name);
      if (!server) {
        throw new Error(`Server "${name}" not found`);
      }
      // In standalone mode, just update status
      server.status = 'connected';
    },

    async stopServer(name) {
      const server = state.servers.get(name);
      if (!server) {
        throw new Error(`Server "${name}" not found`);
      }
      server.status = 'stopped';
    },

    async startServer(name) {
      const server = state.servers.get(name);
      if (!server) {
        throw new Error(`Server "${name}" not found`);
      }
      server.status = 'connected';
    },

    setServerEnabled(name, enabled) {
      const server = state.servers.get(name);
      if (!server) {
        throw new Error(`Server "${name}" not found`);
      }
      server.enabled = enabled;
    },

    // MCPB is not supported in standalone mode
    previewMcpb: undefined,
    setPendingMcpbPreview: undefined,
  };

  const handler = createServerConfigHandler(deps);

  const server = new McpServer(
    {
      name: 'internal-server-config',
      title: 'Server Configuration',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
      },
      instructions:
        'This server provides tools for managing MCP server connections. ' +
        'In standalone mode, server state is kept in memory and not persisted.',
    }
  );

  // Register all tools
  for (const tool of ALL_SERVER_CONFIG_TOOLS) {
    // Get the appropriate schema for each tool
    let inputSchema: z.ZodTypeAny;
    switch (tool.name) {
      case 'server-config__configure-servers':
        inputSchema = ConfigureServersSchema;
        break;
      case 'server-config__list-servers':
        inputSchema = ListServersSchema;
        break;
      case 'server-config__add-server':
        inputSchema = AddServerSchema;
        break;
      case 'server-config__remove-server':
        inputSchema = RemoveServerSchema;
        break;
      case 'server-config__restart-server':
        inputSchema = RestartServerSchema;
        break;
      case 'server-config__stop-server':
        inputSchema = StopServerSchema;
        break;
      case 'server-config__start-server':
        inputSchema = StartServerSchema;
        break;
      case 'server-config__enable-server':
        inputSchema = EnableServerSchema;
        break;
      case 'server-config__disable-server':
        inputSchema = DisableServerSchema;
        break;
      case 'server-config__install-mcpb':
        inputSchema = InstallMcpbSchema;
        break;
      default:
        inputSchema = z.object({});
    }

    // Using type assertion to avoid TypeScript type recursion issue with SDK generics
    (server.registerTool as Function)(
      tool.displayName,
      {
        title: tool.title,
        description: tool.description,
        inputSchema,
        annotations: tool.annotations,
      },
      async (args: unknown) => {
        const result = await handler(tool.name, args as Record<string, unknown>);
        if (result) {
          return {
            content: result.content,
            isError: result.isError,
          };
        }
        return {
          content: [{ type: 'text', text: 'Tool not handled' }],
          isError: true,
        };
      }
    );
  }

  // Register the server-config UI resource
  server.registerResource(
    'server-config-ui',
    SERVER_CONFIG_UI_URI,
    {
      description: 'HTML UI for configuring MCP servers',
      mimeType: 'text/html;mcp-app',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/html;mcp-app',
          text: getServerConfigUI(),
        },
      ],
    })
  );

  // Register the MCPB confirmation UI resource
  server.registerResource(
    'mcpb-confirm-ui',
    MCPB_CONFIRM_UI_URI,
    {
      description: 'HTML UI for confirming MCPB installation',
      mimeType: 'text/html;mcp-app',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/html;mcp-app',
          text: getMcpbConfirmUI(),
        },
      ],
    })
  );

  return {
    server,
    cleanup: () => {
      state.servers.clear();
    },
  };
}
