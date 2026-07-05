# Changelog

## [0.3.0] - 2026-07-04

### Added - Agent Client Protocol (ACP) Client Support

Skilljack can now spawn and drive external coding agents (Claude Code, Codex) over [ACP](https://agentclientprotocol.com) v1 as an alternative chat backend, selected from a dropdown in the chat drawer.

- **Main process** (`src/electron/main/acp/`): agent process spawner with Windows `.cmd`/PATHEXT/registry-PATH handling, `ClientSideConnection` wrapper via `@agentclientprotocol/sdk` 1.x, permission broker (blocking approval cards in the chat UI), cwd-sandboxed `fs/read_text_file`/`fs/write_text_file`, full `terminal/*` support with process-tree kill
- **Agent registry**: user-editable `agents.json` in userData, seeded with Claude Code (`npx -y @agentclientprotocol/claude-agent-acp`) and Codex (`npx -y @agentclientprotocol/codex-acp`); manageable in Settings → Agents
- **Auth**: provider API keys (`ANTHROPIC_API_KEY` etc.) are stripped from agent environments so agents use the user's subscription logins; per-agent env config can re-add keys explicitly
- **MCP passthrough**: enabled stdio servers from `servers.json` are forwarded into agent sessions via `session/new`
- **Config bridge**: a loopback HTTP MCP server (bearer-token auth) exposes Skilljack's server-config tools to agents, backed by the live `McpManager` — agents can list/add/remove/start/stop/enable servers and open the config UI panel in the app
- **Renderer**: backend selector + working-directory chip, permission cards, plan checklist, collapsible thought blocks, diff and live terminal rendering in tool calls, slash-command autocomplete from the agent, mode/config-option selector

### Changed

- Built-in tool packages now conform to the MCP Apps (ext-apps) spec: `ui://` resource URIs, `text/html;profile=mcp-app` mime type, `_meta.ui.resourceUri` tool linkage, registration via `registerAppTool`/`registerAppResource`; `list-servers` declares an `outputSchema` and returns `structuredContent`
- `removeServerConfig` removes just the targeted server instead of restarting every server via a full config reload
- Config UI: "tools hidden" badge for running-but-disabled servers, longer RPC timeout with post-error resync
- Upgraded `@agentclientprotocol/sdk` to 1.1.0; `@modelcontextprotocol/sdk` to 1.29.0
- Gemini CLI dropped from built-in agent defaults (no longer maintained; add as a custom agent if needed)

### Fixed

- `electron:dev` was broken since the Vite 8 bump: module-level `fileURLToPath(import.meta.url)` in the internal packages crashed the CJS main bundle; now resolved lazily
- Standalone package servers advertised empty tool input schemas (Zod object passed where the SDK expects a raw shape)
- Content annotations are stripped at the ACP config bridge boundary as an interop workaround for Codex's MCP client (openai/codex#29002)
- Resolved all dependabot alerts via `tar`/`tmp` overrides; `npm audit` clean

## [0.2.0] - 2025-01-16

### Added - MCP Apps v0.4.1 Support

#### Tool Visibility Filtering
- Added `getToolVisibility(tool)` helper to extract visibility from `_meta.ui.visibility`
- Added `isToolVisibleToModel(tool)` to check if tool should be sent to LLM
- Tools with `visibility: ["app"]` are now hidden from the model/LLM tool list
- App-only tools remain callable by apps via `tools/call`

#### Enhanced Host Context (ui/initialize)
- Host context now includes `theme` (dark/light detection)
- Host context now includes `locale` (navigator.language)
- Host context now includes `toolInfo` with name and arguments
- Host context now includes `availableDisplayModes` (['inline', 'fullscreen'])
- Host context now includes `styles.variables` with CSS custom properties

#### Display Mode Support
- Added `ui/requestDisplayMode` handler for fullscreen/pip/inline mode switching
- Added CSS styles for `.display-mode-fullscreen`, `.display-mode-inline`, `.display-mode-pip`
- Apps can request fullscreen mode (PiP falls back to inline for now)

#### Model Context Support
- Added `ui/modelContext` handler for apps to persist state to model context
- Apps can send `content` and `structuredContent` to update context
- Added `window.onModelContextUpdate` callback hook for integration

#### Tool Cancellation Support
- Added `ui/toolCancelled` notification capability
- Each panel stores a `sendCancellation(reason)` method
- Added `window.cancelMcpAppTool(serverName, uiResourceUri, reason)` global function
- Added `window.cancelAllMcpAppTools(reason)` to cancel all active panels

### Changed
- Upgraded `@modelcontextprotocol/ext-apps` from `^0.3.1` to `^0.4.1`
- Web UI now always uses multi-server mode (required for built-in tool-manager)
- Updated host version to `0.2.0` in ui/initialize response

### Fixed
- Tool-manager now works correctly in single-server configurations

### Files Modified
- `package.json` - Version bump and ext-apps upgrade
- `src/capabilities/apps.ts` - Added visibility helpers
- `src/web/routes.ts` - Added visibility filtering, always use multi-server mode
- `src/web/static/app.js` - Added v0.4.1 message handlers
- `src/web/static/styles.css` - Added display mode CSS
