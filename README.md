# Skilljack Client

Modular sandbox client for showcasing in MCP Apps, servers as agents, and other advanced capabilities.

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

## Design Principles

1. **Thin wrappers** - Minimal abstraction over the SDK
2. **Functions over classes** - `setupX(client)` pattern
3. **Domain-agnostic** - Minimal hardcoded tools, prompts, or workflows
4. **Flexibility and modularity vs baked-in agents or complex frameworks** - Agent Skills and MCP Servers provide specialized knowledge, actions, and behaviors through progressive discovery and dynamic capabilities.
5. **Customizable and fun** - Inspired by old school Winamp skins, GeoCities, and the creative chaos of the early web. Your tools should look however you want.

## License

MIT
