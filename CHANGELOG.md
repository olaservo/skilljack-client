# Changelog

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
