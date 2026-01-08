# MCP Skilljack Client

Modular, composable building blocks for MCP clients. Each capability is standalone - copy what you need.

## Quick Start

```bash
npm install
npm run build
npm start -- --stdio "node path/to/server.js"
```

## Architecture

```
src/
  capabilities/       # Standalone capability modules
    sampling.ts       # setupSampling(client, config)
    elicitation.ts    # setupElicitation(client, config)
    roots.ts          # setupRoots(client, paths)
    list-changed.ts   # setupListChanged(client, callbacks)
    subscriptions.ts  # setupSubscriptions(client, callback)
    logging.ts        # setupLogging(client, callback)
    completions.ts    # completePromptArgument(), pickCompletion()

  transports/         # Transport helpers
    stdio.ts          # createStdioTransport(cmd, args)
    http.ts           # createHttpTransport(url, headers)

  instructions.ts     # combineInstructions() - merge instruction sources
  config.ts           # loadConfig() - load mcp-client.json

  index.ts            # CLI demo composing capabilities
```

## Usage

Each module is self-contained. Copy one file into your project:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { setupSampling } from './capabilities/sampling.js';
import { setupRoots } from './capabilities/roots.js';
import { createStdioTransport } from './transports/stdio.js';

// 1. Create client with capabilities declared
const client = new Client(
  { name: 'my-client', version: '1.0.0' },
  { capabilities: { sampling: {}, roots: { listChanged: true } } }
);

// 2. Set up only what you need
setupSampling(client, { apiKey: process.env.ANTHROPIC_API_KEY });
setupRoots(client, ['/workspace']);

// 3. Connect
await client.connect(createStdioTransport('node', ['server.js']));

// 4. Use the client
const tools = await client.listTools();
await client.callTool({ name: 'my-tool', arguments: {} });
```

## Capabilities

| Module | What it does |
|--------|--------------|
| `sampling.ts` | Handle `sampling/createMessage` requests from servers |
| `elicitation.ts` | Handle `elicitation/create` requests (form/URL modes) |
| `roots.ts` | Expose filesystem roots via `roots/list` |
| `list-changed.ts` | React to `tools/prompts/resources` list changes |
| `subscriptions.ts` | Handle `resources/updated` notifications |
| `logging.ts` | Receive server log messages |
| `completions.ts` | Argument autocompletion for prompts/resources |
| `instructions.ts` | Combine server instructions from multiple sources |
| `config.ts` | Load client configuration from JSON file |

## CLI Options

```
Connection:
  --stdio "command args"       Connect via stdio transport
  --url <url>                  Connect via HTTP transport

Capabilities:
  --sampling                   Enable sampling (requires ANTHROPIC_API_KEY)
  --approval-mode <mode>       Sampling approval: ask (default) or auto
  --roots <paths>              Comma-separated paths to expose as roots
  --log-level <level>          Set logging level (default: info)

Server Instructions:
  --instructions "text"        Add custom instructions for this session
  --no-server-instructions     Disable MCP server instructions
  --config <path>              Custom config file path
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

### Transparency

Active instructions are logged on connect with source attribution:

```
Active instructions:
  [MCP Server] Server-provided instructions here...
  [Config] Config file instructions here...
  [CLI] CLI flag instructions here...
```

### Security Note

Instructions are probabilistic guidance - they influence LLM behavior but don't guarantee it. Do NOT rely on instructions for security-critical operations. Use deterministic code checks, hooks, or tool-level validation instead.

## Design Principles

1. **Each file is standalone** - No dependencies between capabilities
2. **Thin wrappers** - Minimal abstraction over the SDK
3. **Functions over classes** - `setupX(client)` pattern
4. **Copy-paste friendly** - Each file has usage examples
5. **Domain-agnostic** - No hardcoded tools, prompts, or workflows

## License

MIT
