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
- `src/electron/main/acp` - Agent Client Protocol support (spawns external coding agents as stdio subprocesses)
- `src/renderer` - React frontend

## ACP (Agent Client Protocol) Support

The chat drawer's backend selector can drive external coding agents (Claude Code, Codex) over [ACP](https://agentclientprotocol.com) v1 instead of the built-in Doer/Dreamer models.

- `AcpManager` (`src/electron/main/acp/acp-manager.ts`) mirrors `McpManager`: agent registry, one `AcpAgentConnection` per running agent process, event fan-out to the renderer over `acp:*` channels. Serializable protocol mirror types live in `src/shared/acp-types.ts` (the renderer never imports `@agentclientprotocol/sdk`).
- Agent registry is `agents.json` in userData (NOT `servers.json` — entries there are spawned and health-checked as MCP servers at boot). Editable in Settings → Agents.
- Provider API keys (`ANTHROPIC_API_KEY` etc.) are stripped from agent environments (`agent-spawner.ts` `buildAgentEnv`) so agents use subscription logins; per-agent env config re-adds keys explicitly.
- Enabled stdio servers from `servers.json` are forwarded into agent sessions. The "config bridge" (`config-bridge.ts`) additionally exposes Skilljack's server-config tools to agents as a loopback HTTP MCP server backed by the live `McpManager`.
- Interop gotchas: content annotations are stripped at the bridge boundary (Codex's MCP client rejects them — openai/codex#29002); the MCP SDK's `registerTool`/`registerAppTool` need the Zod raw shape (`.shape`), not the `z.object(...)` wrapper, or tools/list advertises empty input schemas.
- Do not use module-level `fileURLToPath(import.meta.url)` in anything bundled into the Electron main process — Vite's CJS output turns it into a crash at app load. Resolve lazily inside functions instead.

## MCP Apps Conventions

Built-in tools follow the MCP Apps (ext-apps / SEP-1865) spec: `ui://` resource URIs, the `RESOURCE_MIME_TYPE` constant (`text/html;profile=mcp-app`) instead of string literals, `_meta.ui.resourceUri` linkage on UI tools, and `registerAppTool`/`registerAppResource` from `@modelcontextprotocol/ext-apps/server` in the standalone servers. Tools that return data (e.g. `list-servers`) declare an `outputSchema` and return matching `structuredContent` alongside the text summary.

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

### UI HTML Files

The UI HTML files exist in two locations:
- `packages/*/src/ui/` - Used by standalone server mode (read from disk at runtime)
- `src/electron/main/ui/` - Used by Electron app (embedded via Vite's `?raw` import at build time)

When modifying UI, update both copies to keep them in sync.
