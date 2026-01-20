# Skilljack Client - Electron Architecture

## Overview

This document outlines the architecture plan for the Skilljack Client Electron application and tracks implementation status. The client is a full-capability MCP (Model Context Protocol) client with a desktop UI, supporting multiple MCP server connections and LLM-powered chat with tool execution.

---

## 🎯 Demo Readiness - Critical Path

**Goal:** Run locally with multiple MCP servers and MCP apps (tools with UIs)

### What Works Today ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Electron app launch | ✅ | `npm run electron:dev` |
| Multi-server connections | ✅ | Via `servers.json` config |
| Tool calling | ✅ | Full MCP tool support |
| MCP Apps (Tool UIs) | ✅ | Sandboxed iframe rendering |
| Chat with LLM | ✅ | Anthropic/OpenAI providers |
| Tool enable/disable | ✅ | Built-in tool manager |
| Settings persistence | ✅ | Model selection, temperature |

### Quick Start (3 Steps)

```bash
# 1. Set up API key
cp .env.example .env
# Edit .env: ANTHROPIC_API_KEY=sk-ant-...

# 2. Configure servers (or use existing servers.json)
cp servers.example.json servers.json
# Edit servers.json to add your MCP servers

# 3. Run
npm install
npm run electron:dev
```

### Example servers.json

```json
{
  "mcpServers": {
    "everything": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything@latest"]
    },
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem", "/path/to/allowed/dir"]
    },
    "memory": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory@latest"]
    }
  }
}
```

### Gaps for Better Demo Experience

| Gap | Impact | Solution |
|-----|--------|----------|
| **Server Config UI** | Must edit JSON manually | Build UI for adding/editing servers |
| **Server Health in UI** | No visibility when servers fail | Integrate server-manager lifecycle events |
| **Connection Errors** | Silent failures | Add toast/notification system |
| **Server Install** | Manual npx commands | Future: Server marketplace/registry |

### Priority Work for Demo Polish

1. **🔴 High Priority - Server Status UI**
   - Show connected/disconnected/error state per server
   - Display in sidebar or status bar
   - Requires: Forward lifecycle events from server-manager

2. **🟡 Medium Priority - Server Config UI**
   - Add/remove servers without editing JSON
   - Basic form: name, command, args
   - Requires: New IPC handlers + React UI

3. **🟢 Nice to Have - Error Toasts**
   - Surface connection failures to user
   - "Server X failed to connect: reason"
   - Requires: Notification component + event handling

---

## Architecture Decisions

### 1. Electron Forge vs Builder

**Decision:** Electron Forge with Vite plugin

**Rationale:**
- First-party tooling with official Vite integration
- Simplified build configuration via `forge.config.ts`
- Built-in support for all major platforms (Windows/macOS/Linux)
- Better integration with Electron ecosystem

**Implementation:** `forge.config.ts` configures makers for Squirrel (Windows), ZIP (macOS/Linux), DEB, and RPM packages.

### 2. IPC Architecture

**Decision:** Typed channel-based `ipcRenderer.invoke()` / `ipcMain.handle()` pattern

**Rationale:**
- Request-response pattern provides clean async API
- TypeScript types ensure contract safety between processes
- Channel whitelist in preload prevents unauthorized access
- Centralized channel definitions in `src/shared/channels.ts`

**Key Patterns:**
- All channels defined as constants with TypeScript types
- Preload validates channels against whitelist before invoking
- IPC handlers registered centrally in `ipc-handlers.ts`
- Event channels use `ipcRenderer.on()` for main→renderer pushes

### 3. Single vs Multiple Windows

**Decision:** Single window architecture

**Rationale:**
- Simpler state management
- Single ServerManager instance
- Tool UIs rendered in sandboxed iframes within the main window
- Future: Could add secondary windows for tool panels if needed

### 4. State Management

**Decision:** React Context for UI state, electron-store for persistence

**Rationale:**
- React Context sufficient for current complexity
- electron-store provides automatic JSON persistence
- No need for Redux/Zustand complexity at this stage
- Settings and disabled tools/servers stored persistently

**Stores:**
- `settings` store: LLM provider settings (model, temperature, etc.)
- `server-manager` store: Disabled tools/servers lists, config path

### 5. Logging & Telemetry

**Decision:** electron-log for structured logging

**Rationale:**
- File + console logging out of the box
- Log rotation and persistence
- Production-ready error tracking

**Configuration:**
- File logging: `info` level
- Console logging: `debug` level (development)

### 6. Process Model for MCP Servers

**Decision:** MCP servers managed in main process via ServerManager

**Rationale:**
- Main process can spawn child processes for stdio transport
- Centralized connection management
- ServerManager wraps multi-server.ts functionality
- Supports stdio, HTTP/SSE, and WebSocket transports

## Directory Structure

```
src/
├── electron/                 # Electron-specific code
│   ├── main/
│   │   ├── index.ts         # Main process entry point
│   │   ├── ipc-handlers.ts  # IPC handler registration
│   │   └── server-manager.ts # MCP client management
│   └── preload/
│       └── host.ts          # Secure preload script
│
├── renderer/                 # Electron renderer (React)
│   ├── App.tsx              # Root component
│   ├── index.html           # HTML entry
│   ├── chat/                # Chat components
│   │   ├── components/      # ChatInput, ChatOutput, etc.
│   │   ├── context/         # ChatContext, ThemeContext
│   │   ├── hooks/           # useToolExecution, etc.
│   │   └── types/           # Chat-specific types
│   ├── settings/            # Settings dialog
│   └── hooks/               # useCommunication adapter hook
│
├── web/                      # Web mode (parallel structure)
│   ├── server.ts            # Express/Hono web server
│   ├── routes.ts            # HTTP API routes
│   ├── chat/                # Web chat components
│   ├── llm/                 # LLM provider integration
│   └── static/              # Static assets
│
├── shared/                   # Cross-process shared code
│   ├── channels.ts          # IPC channel constants
│   ├── types.ts             # API contract types
│   └── index.ts
│
├── communication/            # Transport abstraction
│   ├── types.ts             # CommunicationAdapter interface
│   ├── http-adapter.ts      # Web mode (fetch + WebSocket)
│   ├── ipc-adapter.ts       # Electron mode (IPC)
│   └── index.ts
│
└── [existing MCP client code]
    ├── multi-server.ts      # Multi-server management
    ├── capabilities/        # MCP capability handlers
    └── transports/          # MCP transport implementations
```

## Implementation Status

### Completed ✅

| Feature | Description | Key Files |
|---------|-------------|-----------|
| Electron Forge Setup | Build tooling with Vite plugin | `forge.config.ts`, `vite.*.config.ts` |
| Main Process | BrowserWindow creation with secure defaults | `src/electron/main/index.ts` |
| IPC Architecture | Typed channel-based communication | `src/shared/channels.ts` |
| Preload Script | Secure contextBridge API exposure | `src/electron/preload/host.ts` |
| ServerManager | MCP client lifecycle management | `src/electron/main/server-manager.ts` |
| IPC Handlers | Request handlers for all MCP operations | `src/electron/main/ipc-handlers.ts` |
| Communication Adapters | HTTP/IPC abstraction layer | `src/communication/` |
| Chat Streaming | Async iterator-based stream handling | IPC adapter + handlers |
| Tool Management | Enable/disable tools and servers | ToolManagerState class |
| Settings Persistence | electron-store for preferences | Settings store in handlers |
| Window Controls | Minimize/maximize/close via IPC | Window channel handlers |
| ESM/CJS Build Fix | CommonJS output for main/preload | `vite.main.config.ts` |
| **MCP Server Manager Integration** | Lifecycle management with health checks, auto-restart | `packages/mcp-server-manager/`, `src/electron/main/mcp-manager.ts` |
| **Tool Execution Fix** | Fixed adapter singleton + property name issues | `src/renderer/hooks/useCommunication.ts`, `src/renderer/chat/hooks/useToolExecution.ts` |
| **Core Functionality Tests** | Vitest tests for adapter, types, tool execution | `tests/*.test.ts`, `vitest.config.ts` |

### In Progress / Planned

| Feature | Status | GitHub Issue |
|---------|--------|--------------|
| **🐛 Tool Manager UI not rendering** | Bug - High Priority | - |
| **🐛 Chat panel resize not working** | Bug - Medium Priority | - |
| **Server Lifecycle UI** | Next Session | - |
| **Lifecycle Integration Testing** | Next Session | - |
| Fuses Security Hardening | Planned | [#2](https://github.com/olaservo/skilljack-client/issues/2) |
| Session Token Auth | Planned | [#3](https://github.com/olaservo/skilljack-client/issues/3) |
| utilityProcess for MCP Servers | Research | [#4](https://github.com/olaservo/skilljack-client/issues/4) |
| Code Signing Configuration | Planned | [#5](https://github.com/olaservo/skilljack-client/issues/5) |
| OAuth Custom Protocol | Planned | [#6](https://github.com/olaservo/skilljack-client/issues/6) |
| Apache License Disclosure | Documentation | [#7](https://github.com/olaservo/skilljack-client/issues/7) |

#### Issue Details

**#2 - Fuses Security Hardening**
Add Electron Fuses plugin to harden production builds:
- Disable `ELECTRON_RUN_AS_NODE`
- Block `NODE_OPTIONS` injection
- Enable ASAR integrity validation

**#3 - Session Token Auth**
Protect localhost HTTP API (web mode) from CSRF/DNS rebinding:
- Generate session token on server start
- Require `X-Session-Token` header on API requests

**#4 - utilityProcess Evaluation**
Research using Electron's `utilityProcess` instead of `child_process.spawn()` for MCP servers:
- Better security isolation and sandboxing
- Need to verify compatibility with MCP SDK stdio transport

**#5 - Code Signing**
Implement production code signing for distribution:
- macOS: Apple identity, hardened runtime, notarization
- Windows: Certificate signing via Squirrel

**#6 - OAuth Custom Protocol**
Register `skilljack://` protocol for OAuth callback handling:
- Enable seamless OAuth flows with MCP servers
- Handle callbacks across all platforms

---

## 🐛 Known Issues

### ✅ FIXED: Tool execution using HTTP adapter instead of IPC in Electron mode

**Status:** Fixed on 2025-01-19

**Root Causes Found:**
1. `useToolExecution.ts` made direct HTTP fetch calls instead of using the communication adapter
2. Code referenced `toolCall.name` but `ChatToolCall` interface uses `qualifiedName`
3. `useCommunication()` hook created per-component adapter instances, breaking stream listener

**Fixes Applied:**
1. Updated `useToolExecution.ts` to use `getCommunicationAdapter()` singleton
2. Changed `toolCall.name` → `toolCall.qualifiedName` (3 occurrences)
3. Refactored `useCommunication.ts` to use true module-level singleton shared by both hook and static function

**Tests Added:** `tests/communication-adapter.test.ts`, `tests/tool-execution.test.ts`, `tests/chat-types.test.ts` (28 tests total)

---

### BUG: Tool Manager tool UI not rendering after tool call

**Symptom:** Tool Manager tool can be called successfully but its UI panel doesn't appear.

**Location:** Likely `src/renderer/chat/hooks/useToolExecution.ts` (MCP App loading section) or `window.loadMcpApp` implementation.

**Priority:** High

---

### BUG: Terminal chat panel resize not working

**Symptom:** Cannot resize the terminal chat panel by dragging.

**Location:** Chat panel component, likely missing resize handle or CSS.

**Priority:** Medium

---

## Next Session: Server Lifecycle UI & Testing

### Server Lifecycle UI

Build UI components to surface the new lifecycle management capabilities:

**1. Server Status Display**
- Show status badge per server: `connected` | `connecting` | `unhealthy` | `restarting` | `failed`
- Display health indicator (healthy/unhealthy)
- Show restart attempt count when applicable

**2. Server Control Actions**
- Restart button per server (calls `electronAPI.restartServer(name)`)
- Stop/Start toggle for manual control
- Confirmation dialog for destructive actions

**3. Event Notifications**
- Toast/notification when server crashes
- Toast when auto-restart succeeds/fails
- Status bar indicator for overall health

**Available IPC APIs:**
```typescript
// Invoke
electronAPI.getServerLifecycleStates()  // → { states: ServerStateSummary[] }
electronAPI.restartServer(name)
electronAPI.stopServer(name)
electronAPI.startServer(name)

// Events
electronAPI.onServerStatusChanged(callback)
electronAPI.onServerHealthy(callback)
electronAPI.onServerUnhealthy(callback)
electronAPI.onServerCrashed(callback)
electronAPI.onServerRestarting(callback)
electronAPI.onManagerReady(callback)
```

### Lifecycle Integration Testing

**Test Scenarios:**
1. **Normal startup** - Verify servers connect and emit `server:connected`
2. **Process crash** - Kill MCP server process, verify auto-restart triggers
3. **Health check failure** - Simulate unresponsive server, verify `unhealthy` state
4. **Max retries exceeded** - Crash server repeatedly, verify `failed` state after 5 attempts
5. **Graceful shutdown** - Close app, verify no orphan MCP processes
6. **Manual restart** - Call `restartServer()`, verify reconnection

**Key Files:**
- `src/electron/main/mcp-manager.ts` - Lifecycle orchestration
- `packages/mcp-server-manager/` - Core lifecycle logic
- `src/shared/channels.ts` - IPC channel definitions
- `src/electron/preload/host.ts` - Renderer API exposure

---

### Deviations from Original Plan

#### Dual Web + Electron Architecture

The implementation supports **both** web and Electron modes:

- **Web Mode** (`npm run dev:chat`): Runs as a web app with Express server
  - Uses HTTP adapter (`fetch` + WebSocket for events)
  - LLM calls made server-side
  - MCP servers connected via web server

- **Electron Mode** (`npm run electron:dev`): Runs as desktop app
  - Uses IPC adapter (contextBridge API)
  - LLM calls made in main process
  - MCP servers managed by ServerManager

This dual architecture required:
1. Parallel component trees (`src/renderer/` and `src/web/`)
2. Communication adapter abstraction (`src/communication/`)
3. Shared types for API contracts (`src/shared/types.ts`)

The `useCommunication` hook automatically selects the appropriate adapter based on runtime environment.

#### Directory Structure Differences

The original plan proposed a simpler structure, but the dual-mode support necessitated:
- Separate `renderer/` and `web/` directories for mode-specific UI code
- Shared `communication/` module for transport abstraction
- Some component duplication (being consolidated incrementally)

## Key Files Reference

### Electron Main Process

| File | Purpose |
|------|---------|
| `src/electron/main/index.ts` | Entry point, window creation, app lifecycle |
| `src/electron/main/ipc-handlers.ts` | All IPC handler registrations |
| `src/electron/main/server-manager.ts` | MCP client management wrapper |

### Preload

| File | Purpose |
|------|---------|
| `src/electron/preload/host.ts` | contextBridge API, channel validation |

### Shared

| File | Purpose |
|------|---------|
| `src/shared/channels.ts` | IPC channel constants and types |
| `src/shared/types.ts` | API contract types (tools, resources, chat, etc.) |

### Communication

| File | Purpose |
|------|---------|
| `src/communication/types.ts` | CommunicationAdapter interface |
| `src/communication/http-adapter.ts` | Web mode implementation |
| `src/communication/ipc-adapter.ts` | Electron mode implementation |

### Build Configuration

| File | Purpose |
|------|---------|
| `forge.config.ts` | Electron Forge config with makers |
| `vite.main.config.ts` | Main process build (CommonJS output) |
| `vite.preload.config.ts` | Preload script build |
| `vite.renderer.config.ts` | Renderer process build (React) |

## Security Model

1. **Context Isolation**: `contextIsolation: true` prevents renderer access to Node.js
2. **Sandbox**: `sandbox: true` enforces process isolation
3. **No Node Integration**: `nodeIntegration: false` in renderer
4. **Channel Whitelist**: Preload validates all IPC channels against allowed list
5. **Typed Contracts**: TypeScript interfaces enforce API boundaries

## ✅ Completed: MCP Server Manager Integration

The `@skilljack/mcp-server-manager` package has been integrated as a workspace package, providing enterprise-grade lifecycle management for MCP servers.

### Package Features

The server-manager package provides:

- **Lifecycle States**: `disconnected` → `connecting` → `connected` ↔ `unhealthy` → `restarting` → `failed`/`stopped`
- **Health Checks**: Ping-based monitoring with configurable interval, timeout, and failure threshold
- **Auto-Restart**: Exponential backoff with configurable max attempts
- **Process Management**: Graceful shutdown with SIGTERM→SIGKILL escalation
- **HTTP Support**: For remote MCP servers
- **Type-safe Events**: Full TypeScript event system for lifecycle notifications
- **Pluggable Logging**: Logger interface compatible with electron-log

### Event Types Available

```typescript
// Lifecycle events
'server:status-changed'    // Any status transition
'server:healthy'           // Server passed health check
'server:unhealthy'         // Server failed health checks
'server:crashed'           // Process exited unexpectedly
'server:restarting'        // Auto-restart initiated
'server:restart-succeeded' // Restart completed
'server:restart-failed'    // Max retries exceeded
'server:stopped'           // Graceful shutdown
'server:connecting'        // Connection in progress
'server:connected'         // Successfully connected
'server:connection-failed' // Connection error

// Manager events
'manager:ready'            // All servers started
'manager:shutdown'         // Manager shutting down
'manager:state-snapshot'   // Periodic state broadcast
```

### Integration Status: ✅ Complete

All phases completed. Key implementation files:

| Phase | Status | Implementation |
|-------|--------|----------------|
| 1. Workspace Package | ✅ | `packages/mcp-server-manager/` |
| 2. Lifecycle Adapter | ✅ | Integrated into `src/electron/main/mcp-manager.ts` |
| 3. IPC Channels | ✅ | `src/shared/channels.ts` (10 new channels) |
| 4. Preload Script | ✅ | `src/electron/preload/host.ts` |
| 5. Refactor ServerManager | ✅ | Replaced with `McpManager` class |

#### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        McpManager                                │
│  (thin orchestration layer - ~150 lines)                        │
│                                                                  │
│   ┌──────────────────┐    ┌──────────────────┐                  │
│   │ LifecycleManager │    │ ToolManagerState │                  │
│   │ (from package)   │    │ (electron-store) │                  │
│   └────────┬─────────┘    └────────┬─────────┘                  │
│            │                       │                             │
│            │ getConnectedClients() │ filterEnabledTools()       │
│            ▼                       ▼                             │
│   ┌──────────────────────────────────────────┐                  │
│   │         multi-server.ts                  │                  │
│   │   aggregateTools(clients)                │                  │
│   │   callTool(clients, name, args)          │                  │
│   └──────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

#### IPC Channels Added

```typescript
// Invoke channels
'mcp:get-server-lifecycle-states'
'mcp:restart-server'
'mcp:stop-server'
'mcp:start-server'

// Event channels (main → renderer)
'mcp:on-server-status-changed'
'mcp:on-server-healthy'
'mcp:on-server-unhealthy'
'mcp:on-server-crashed'
'mcp:on-server-restarting'
'mcp:on-manager-ready'
```

<details>
<summary>Original Integration Plan (for reference)</summary>

#### Phase 1: Add as Workspace Package

```
skilljack-client/
├── package.json           # Add "workspaces": ["packages/*"]
└── packages/
    └── mcp-server-manager/  # Move from skilljack-server-manager repo
```

#### Phase 2: Create Lifecycle Adapter

New file: `src/electron/main/lifecycle-adapter.ts`

```typescript
import { ServerManager } from '@skilljack/mcp-server-manager';
import { BrowserWindow } from 'electron';

export class LifecycleAdapter {
  constructor(manager: ServerManager, window: BrowserWindow) {
    // Forward all lifecycle events to renderer via IPC
    manager.onAnyLifecycleEvent((event) => {
      window.webContents.send(`mcp:${event.type}`, event);
    });
  }
}
```

#### Phase 3: Add IPC Channels

Update `src/shared/channels.ts`:

```typescript
// Lifecycle event channels (main → renderer)
export const ON_SERVER_STATUS_CHANGED = 'mcp:server:status-changed';
export const ON_SERVER_HEALTHY = 'mcp:server:healthy';
export const ON_SERVER_UNHEALTHY = 'mcp:server:unhealthy';
export const ON_SERVER_CRASHED = 'mcp:server:crashed';
export const ON_SERVER_RESTARTING = 'mcp:server:restarting';
// ... etc
```

#### Phase 4: Update Preload Script

Extend `src/electron/preload/host.ts`:

```typescript
contextBridge.exposeInMainWorld('mcpLifecycle', {
  onStatusChanged: (callback) => /* ... */,
  onHealthy: (callback) => /* ... */,
  // ... etc
});
```

#### Phase 5: Refactor ServerManager

The current `src/electron/main/server-manager.ts` will be refactored to:
1. Use `@skilljack/mcp-server-manager` internally
2. Maintain backward compatibility with existing IPC handlers
3. Add new lifecycle event forwarding

### Benefits After Integration

| Current | After Integration |
|---------|-------------------|
| Manual connection handling | Automatic reconnection |
| No health monitoring | Configurable health checks |
| Server crash = lost | Auto-restart with backoff |
| Basic status (connected/error) | Rich lifecycle states |
| No process supervision | Full process management |

### Source Repository

The server-manager package is developed at:
`../skilljack-server-manager/packages/mcp-server-manager/`

See `skilljack-server-manager/TODO.md` for detailed integration steps.

</details>

## Related Documentation

- [Fixing Electron ESM/CJS Build Issue](./electron-esm-cjs-fix.md)
