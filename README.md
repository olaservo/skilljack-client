# Skilljack Client

A modular MCP client for showcasing MCP Apps, server-side agents, agent skills, and advanced capabilities.

## Quick Start

**Single server (stdio):**
```bash
node dist/index.js --stdio "npx -y @anthropic-ai/echo-server" --sampling
```

**Single server (HTTP):**
```bash
node dist/index.js --url http://localhost:3001/mcp --sampling
```

**Web UI mode:**
```bash
node dist/index.js --url http://localhost:3001/mcp --sampling --web
# Opens browser at http://localhost:8080
```

**Multi-server mode:**
```bash
node dist/index.js --servers servers.json --web
```

## Features

### MCP Client Capabilities

| Capability | Description |
|------------|-------------|
| **Sampling** | Handle server-initiated LLM requests with tool support. Enables servers to run agentic loops. |
| **Elicitation** | Handle server-initiated user input via forms or URL redirects. |
| **Roots** | Expose filesystem directories to servers for context. |
| **Logging** | Receive and display server log messages at configurable levels. |

### Server Capability Support

| Capability | Description |
|------------|-------------|
| **List Changed** | React to dynamic tool/prompt/resource changes from servers. |
| **Subscriptions** | Subscribe to resource updates and receive real-time notifications. |
| **Completions** | Support argument autocompletion for prompts and resources. |
| **Tasks** | Handle long-running operations with progress tracking and cancellation. |

### MCP Apps (SEP-1865)

Tools can deliver interactive HTML UIs that render in sandboxed iframes. When a tool has an associated `ui://` resource, the web UI fetches and renders it with:

- **Sandboxed iframe** on a separate port for security isolation
- **Message passing** between app and client via postMessage
- **CSP support** for apps that need external connections

## CLI Reference

```
Connection:
  --stdio "command args"       Connect via stdio transport
  --url <url>                  Connect via HTTP transport

Capabilities:
  --sampling                   Enable sampling (requires ANTHROPIC_API_KEY)
  --approval-mode <mode>       ask (default) or auto
  --roots <paths>              Comma-separated paths to expose
  --log-level <level>          debug, info (default), warn, error

Web UI:
  --web [port]                 Start web UI (default: 8080)

Multi-Server:
  --servers <config.json>      Connect to multiple servers
                               Format: { "mcpServers": { "name": { "transport": "http", "url": "..." } } }

Server Instructions:
  --instructions "text"        Add custom instructions for this session
  --no-server-instructions     Disable MCP server instructions
  --config <path>              Custom config file path

Testing:
  --conformance [scenario] <url>   Run conformance test scenarios
                                   Scenarios: initialize, tools-call, elicitation-defaults
```

## Server Instructions

The client supports combining instructions from multiple sources, following [MCP best practices](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/):

1. **MCP Server** - Instructions provided by servers during initialization
2. **Config File** - Per-server instructions in `mcp-client.json`
3. **CLI Flag** - One-off instructions via `--instructions`

Instructions are prepended to the system prompt in sampling requests.

### Config File Format

Create `mcp-client.json` in the current directory or home directory:

```json
{
  "servers": {
    "server-name": {
      "instructions": "Custom instructions for this server."
    }
  }
}
```

## Design Principles

1. **Thin wrappers** - Minimal abstraction over the SDK
2. **Functions over classes** - `setupX(client)` pattern for easy composition
3. **Domain-agnostic** - Minimal hardcoded tools, prompts, or workflows
4. **Flexibility and modularity vs baked-in agents or complex frameworks** - Agent Skills and MCP Servers provide specialized knowledge, actions, and behaviors through progressive discovery and dynamic capabilities.
5. **Customizable and fun** - Inspired by old school Winamp skins, GeoCities, and the creative chaos of the early web. Your tools should look however you want.

### Example: Composing Capabilities

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { setupSampling } from './capabilities/sampling.js';
import { setupRoots } from './capabilities/roots.js';
import { setupLogging } from './capabilities/logging.js';

const client = new Client(
  { name: 'my-client', version: '1.0.0' },
  { capabilities: { sampling: { tools: {} }, roots: { listChanged: true } } }
);

// Each setup function is independent - use what you need
setupSampling(client, {
  apiKey: process.env.ANTHROPIC_API_KEY,
  onApprovalRequest: async (request) => confirm('Approve?'),
  onResponse: (response) => console.log(response),
});

setupRoots(client, ['/home/user/projects']);

setupLogging(client, (level, message) => console.log(`[${level}] ${message}`));

await client.connect(transport);
```

## License

MIT
