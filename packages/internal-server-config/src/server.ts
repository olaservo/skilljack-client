/**
 * Server factory for running internal-server-config as a standalone MCP server.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  SERVER_CONFIG_ACTION_TOOLS,
  CONFIGURE_SERVERS_TOOL,
  INSTALL_MCPB_TOOL,
  SERVER_CONFIG_UI_URI,
  MCPB_CONFIRM_UI_URI,
  ConfigureServersSchema,
  ListServersSchema,
  ListServersOutputSchema,
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

  // Wraps the shared handler into an MCP CallToolResult
  const callHandler = async (toolName: string, args: unknown) => {
    const result = await handler(toolName, args as Record<string, unknown>);
    if (result) {
      return {
        content: result.content,
        ...(result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent }
          : {}),
        isError: result.isError,
      };
    }
    return {
      content: [{ type: 'text' as const, text: 'Tool not handled' }],
      isError: true,
    };
  };

  // UI tools use registerAppTool so tools/list carries the standard
  // _meta.ui.resourceUri linkage (MCP Apps / SEP-1865).
  // Function cast avoids TS2589 type recursion in the SDK generics.
  (registerAppTool as Function)(
    server,
    CONFIGURE_SERVERS_TOOL.displayName,
    {
      title: CONFIGURE_SERVERS_TOOL.title,
      description: CONFIGURE_SERVERS_TOOL.description,
      inputSchema: ConfigureServersSchema.shape,
      _meta: { ui: { resourceUri: SERVER_CONFIG_UI_URI } },
      annotations: CONFIGURE_SERVERS_TOOL.annotations,
    },
    async (args: unknown) => callHandler(CONFIGURE_SERVERS_TOOL.name, args)
  );

  (registerAppTool as Function)(
    server,
    INSTALL_MCPB_TOOL.displayName,
    {
      title: INSTALL_MCPB_TOOL.title,
      description: INSTALL_MCPB_TOOL.description,
      inputSchema: InstallMcpbSchema.shape,
      _meta: { ui: { resourceUri: MCPB_CONFIRM_UI_URI } },
      annotations: INSTALL_MCPB_TOOL.annotations,
    },
    async (args: unknown) => callHandler(INSTALL_MCPB_TOOL.name, args)
  );

  // Action tools (no UI). registerTool expects the Zod RAW SHAPE, not the
  // z.object(...) wrapper — passing the object makes tools/list advertise
  // an empty input schema.
  const ACTION_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
    'server-config__list-servers': ListServersSchema,
    'server-config__add-server': AddServerSchema,
    'server-config__remove-server': RemoveServerSchema,
    'server-config__restart-server': RestartServerSchema,
    'server-config__stop-server': StopServerSchema,
    'server-config__start-server': StartServerSchema,
    'server-config__enable-server': EnableServerSchema,
    'server-config__disable-server': DisableServerSchema,
  };

  for (const tool of SERVER_CONFIG_ACTION_TOOLS) {
    if (tool.name === INSTALL_MCPB_TOOL.name) continue; // registered above with UI meta
    const inputSchema = ACTION_SCHEMAS[tool.name] ?? z.object({});

    // Using type assertion to avoid TypeScript type recursion issue with SDK generics.
    (server.registerTool as Function)(
      tool.displayName,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: inputSchema.shape,
        // list-servers returns structuredContent matching this schema
        ...(tool.name === 'server-config__list-servers'
          ? { outputSchema: ListServersOutputSchema.shape }
          : {}),
        annotations: tool.annotations,
      },
      async (args: unknown) => callHandler(tool.name, args)
    );
  }

  // Register the UI resources with the standard MCP Apps mime type
  registerAppResource(
    server,
    'server-config-ui',
    SERVER_CONFIG_UI_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: 'HTML UI for configuring MCP servers' },
    async () => ({
      contents: [
        { uri: SERVER_CONFIG_UI_URI, mimeType: RESOURCE_MIME_TYPE, text: getServerConfigUI() },
      ],
    })
  );

  registerAppResource(
    server,
    'mcpb-confirm-ui',
    MCPB_CONFIRM_UI_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: 'HTML UI for confirming MCPB installation' },
    async () => ({
      contents: [
        { uri: MCPB_CONFIRM_UI_URI, mimeType: RESOURCE_MIME_TYPE, text: getMcpbConfirmUI() },
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
