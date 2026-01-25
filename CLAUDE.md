# Skilljack Client

## Setup

After cloning or switching branches, build all local packages before running the dev server:

```bash
# Build all packages
cd packages/mcp-server-manager && npm run build && cd ../..
cd packages/internal-tool-manager && npm run build && cd ../..
cd packages/internal-server-config && npm run build && cd ../..
```

Then start the Electron app:

```bash
npm run electron:dev
```

## Project Structure

- `packages/mcp-server-manager` - MCP server lifecycle management
- `packages/internal-tool-manager` - Built-in tool manager (dual-use: standalone server + internal import)
- `packages/internal-server-config` - Built-in server config tools (dual-use: standalone server + internal import)
- `src/electron` - Electron main process and preload scripts
- `src/renderer` - React frontend

## Testing Standalone Packages

The internal packages can run as standalone MCP servers:

```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector@latest node packages/internal-tool-manager/dist/cli.js
npx @modelcontextprotocol/inspector@latest node packages/internal-server-config/dist/cli.js
```

## Package Architecture

### Dual-Use Pattern

The internal packages (`internal-tool-manager`, `internal-server-config`) support two usage modes:

1. **Standalone MCP Server** - Run via stdio with the CLI entry point
2. **Internal Import** - Import tools, handlers, and UI loaders directly into the client app

### Key Exports

**internal-tool-manager:**
- `createServer()` - Server factory for standalone mode
- `MANAGE_TOOLS_TOOL` - Tool definition
- `handleManageTools()` - Tool handler
- `getToolManagerUI()` - UI HTML loader
- `TOOL_MANAGER_UI_URI` - Resource URI constant

**internal-server-config:**
- `createServer()` - Server factory for standalone mode
- `ALL_SERVER_CONFIG_TOOLS` - Array of all tool definitions
- `createServerConfigHandler(deps)` - Handler factory with dependency injection
- `getServerConfigUI()` - Server config UI loader
- `getMcpbConfirmUI()` - MCPB confirmation UI loader
- `SERVER_CONFIG_UI_URI`, `MCPB_CONFIRM_UI_URI` - Resource URI constants
