# @skilljack/mcp-server-manager

A loosely coupled lifecycle manager for MCP (Model Context Protocol) servers with health checks, auto-restart, and graceful shutdown capabilities.

## Features

- **Lifecycle Management** - Start, stop, restart servers with proper state tracking
- **Health Monitoring** - Periodic ping-based health checks with configurable thresholds
- **Auto-Restart** - Automatic recovery from crashes with exponential backoff
- **Graceful Shutdown** - Clean shutdown with configurable timeouts and force-kill fallback
- **Two Transport Types** - Support for stdio (child processes) and HTTP connections
- **Event System** - Comprehensive events for monitoring server states
- **Dynamic Management** - Add/remove servers at runtime

## Installation

```bash
npm install @skilljack/mcp-server-manager
```

**Peer Dependency:** Requires `@modelcontextprotocol/sdk` ^1.0.0

## Quick Start

```typescript
import {
  ServerManager,
  createServerConfig,
  createStdioConfig,
} from '@skilljack/mcp-server-manager';

// Create a manager with server configurations
const manager = ServerManager.fromConfig({
  servers: [
    createServerConfig('my-server', createStdioConfig('npx', ['-y', '@modelcontextprotocol/server-everything']))
  ]
});

// Listen for events
manager.on('server:connected', (event) => {
  console.log(`Server ${event.serverName} connected`);
});

// Start all servers
await manager.start();

// Use the MCP client
const client = manager.getClient('my-server');
if (client) {
  const tools = await client.listTools();
}

// Graceful shutdown
await manager.shutdown();
```

## Configuration

### Server Configuration

```typescript
interface ServerConfig {
  name: string;                        // Unique server identifier
  connection: ServerConnectionConfig;  // Stdio or HTTP config
  lifecycle?: LifecycleConfig;         // Optional lifecycle overrides
  autoStart?: boolean;                 // Auto-start with manager (default: true)
}
```

### Stdio Connection (Child Process)

Spawns a child process and communicates via stdin/stdout pipes.

```typescript
import { createStdioConfig } from '@skilljack/mcp-server-manager';

const config = createStdioConfig('npx', ['-y', '@modelcontextprotocol/server-everything'], {
  env: { DEBUG: 'true' },  // Optional environment variables
  cwd: '/path/to/dir',     // Optional working directory
});
```

### HTTP Connection

Connects to an existing HTTP-based MCP server.

```typescript
import { createHttpConfig } from '@skilljack/mcp-server-manager';

const config = createHttpConfig('http://localhost:3000', {
  headers: { 'Authorization': 'Bearer token' },  // Optional headers
});
```

### Lifecycle Configuration

Override default lifecycle behavior per-server or globally:

```typescript
interface LifecycleConfig {
  healthCheckEnabled?: boolean;       // Enable health checks (default: true)
  healthCheckIntervalMs?: number;     // Check interval (default: 30000)
  healthCheckTimeoutMs?: number;      // Check timeout (default: 5000)
  unhealthyThreshold?: number;        // Failures before unhealthy (default: 3)
  autoRestartEnabled?: boolean;       // Enable auto-restart (default: true)
  maxRestartAttempts?: number;        // Max restart tries (default: 5)
  restartBackoffBaseMs?: number;      // Backoff base delay (default: 1000)
  restartBackoffMaxMs?: number;       // Max backoff delay (default: 30000)
  shutdownTimeoutMs?: number;         // Graceful shutdown timeout (default: 10000)
}
```

### Full Configuration Example

```typescript
const manager = ServerManager.fromConfig({
  // Global defaults (optional)
  defaults: {
    healthCheckIntervalMs: 60000,
    maxRestartAttempts: 3,
  },
  servers: [
    {
      name: 'primary',
      connection: { type: 'stdio', command: 'node', args: ['server.js'] },
      autoStart: true,
    },
    {
      name: 'secondary',
      connection: { type: 'http', url: 'http://localhost:8080' },
      autoStart: false,
      lifecycle: {
        healthCheckEnabled: false,  // Override for this server
      },
    },
  ],
});
```

## Server Lifecycle States

```
disconnected ──start()──▶ connecting ──success──▶ connected
                              │                       │
                              │                       │ health check failures
                              ▼                       ▼
                           failed ◀────────────── unhealthy
                              ▲                       │
                              │                       │ auto-restart
                              │                       ▼
                              └──max attempts──── restarting
                                                      │
                                                      │ success
                                                      ▼
                                                  connecting

Any state ──stop()──▶ stopped
```

| Status | Description |
|--------|-------------|
| `disconnected` | Initial state, not yet started |
| `connecting` | Connection in progress |
| `connected` | Successfully connected and healthy |
| `unhealthy` | Health checks failing |
| `restarting` | Auto-restart in progress |
| `failed` | Max restart attempts exceeded |
| `stopped` | Manually stopped |

## Events

### Lifecycle Events

| Event | Description | Key Properties |
|-------|-------------|----------------|
| `server:connecting` | Connection starting | `serverName` |
| `server:connected` | Successfully connected | `serverName`, `pid?` |
| `server:connection-failed` | Connection failed | `serverName`, `error` |
| `server:healthy` | Health check passed | `serverName`, `healthCheck` |
| `server:unhealthy` | Health checks failing | `serverName`, `consecutiveFailures` |
| `server:crashed` | Process crashed | `serverName`, `exitCode`, `signal`, `willRestart` |
| `server:restarting` | Restart initiated | `serverName`, `attempt`, `maxAttempts`, `reason` |
| `server:restart-succeeded` | Restart successful | `serverName`, `attempts`, `pid?` |
| `server:restart-failed` | All restart attempts failed | `serverName`, `attempts`, `error` |
| `server:status-changed` | Any status change | `serverName`, `previousStatus`, `newStatus` |
| `server:stopped` | Server stopped | `serverName`, `graceful` |

### Manager Events

| Event | Description | Key Properties |
|-------|-------------|----------------|
| `manager:ready` | All auto-start servers started | `serverCount` |
| `manager:shutdown` | Shutdown complete | `graceful` |
| `manager:state-snapshot` | State snapshot emitted | `servers` (array of summaries) |

### Event Usage

```typescript
// Specific event
manager.on('server:connected', (event) => {
  console.log(`${event.serverName} connected with PID ${event.pid}`);
});

// All lifecycle events
manager.on('*', (event) => {
  console.log(`Event: ${event.type}`, event);
});

// All manager events
manager.on('manager:*', (event) => {
  console.log(`Manager event: ${event.type}`);
});

// Typed event helpers
manager.onLifecycleEvent('server:unhealthy', (event) => {
  console.log(`${event.serverName} unhealthy after ${event.consecutiveFailures} failures`);
});

manager.onManagerEvent('manager:ready', (event) => {
  console.log(`Manager ready with ${event.serverCount} servers`);
});
```

## API Reference

### ServerManager

#### Static Methods

```typescript
// Create from config object
ServerManager.fromConfig(config: ManagerConfig, options?: ServerManagerOptions): ServerManager

// Create from config file
ServerManager.fromConfigFile(filePath: string, options?: ServerManagerOptions): Promise<ServerManager>
```

#### Instance Methods

```typescript
// Lifecycle
start(): Promise<void>              // Start all auto-start servers
shutdown(): Promise<void>           // Stop all servers gracefully
startServer(name: string): Promise<void>
stopServer(name: string): Promise<void>
restartServer(name: string): Promise<void>

// State
getServerStatus(name: string): ServerStatus | undefined
getServerState(name: string): ServerStateSummary | undefined
getAllServerStates(): ServerStateSummary[]
isServerConnected(name: string): boolean
areAllServersConnected(): boolean

// Clients
getClient(name: string): Client | null
getConnectedClients(): Map<string, Client>

// Management
getServerNames(): string[]
getServerCount(): number
addServer(config: ServerConfig): void
removeServer(name: string): Promise<void>

// Events
emitStateSnapshot(): void
```

### ServerStateSummary

```typescript
interface ServerStateSummary {
  name: string;
  status: ServerStatus;
  healthy: boolean;
  timeInStatus: number;      // milliseconds
  pid?: number;
  lastLatencyMs?: number;    // last health check latency
  restartAttempts: number;
  error?: string;
}
```

## Advanced Usage

### Custom Logger

```typescript
import { ServerManager, ConsoleLoggerFactory } from '@skilljack/mcp-server-manager';

const manager = ServerManager.fromConfig(config, {
  loggerFactory: new ConsoleLoggerFactory('debug'),
});
```

### Using Core Components Directly

For advanced use cases, you can use the underlying components:

```typescript
import {
  ServerLifecycle,
  ProcessManager,
  HealthMonitor,
  HttpConnection,
} from '@skilljack/mcp-server-manager';

// Create a single server lifecycle
const lifecycle = new ServerLifecycle(serverConfig, lifecycleDefaults);
lifecycle.on('*', (event) => console.log(event));
await lifecycle.start();
```

### Retry Utilities

```typescript
import { retry, withTimeout, calculateBackoff } from '@skilljack/mcp-server-manager';

// Retry an operation
const result = await retry(
  async () => fetchData(),
  { maxAttempts: 3, backoff: { baseMs: 1000, maxMs: 10000 } }
);

// Add timeout to a promise
const data = await withTimeout(fetchData(), 5000);
```

## Architecture

```
ServerManager
    │
    ├── ServerLifecycle (one per server)
    │   ├── ProcessManager (stdio transport)
    │   │   └── Child Process (stdin/stdout pipes)
    │   │
    │   ├── HttpConnection (http transport)
    │   │
    │   ├── MCP Client
    │   │   └── Transport (StdioClientTransport or StreamableHTTPClientTransport)
    │   │
    │   └── HealthMonitor
    │       └── Periodic ping checks
    │
    └── Event Emitter
        └── Forwards all lifecycle events
```

## License

MIT
