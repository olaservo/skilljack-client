# MCP Skilljack Client - Interactive Testing Guide

## Quick Start

```bash
# Terminal 1: Start the everything server
node "C:\Users\johnn\OneDrive\Documents\GitHub\building-more-capable-clients\servers\src\everything\dist\index.js" streamableHttp

# Terminal 2: Start the client
cd C:\Users\johnn\OneDrive\Documents\GitHub\skilljack-repos\skilljack-client
npm start -- --url http://localhost:3001/mcp --sampling
```

---

## Interactive Commands

Once connected, you'll see a `>` prompt. Available commands:

| Command | Description |
|---------|-------------|
| `call <tool> [json]` | Call a tool with optional JSON arguments |
| `read <uri>` | Read a resource by URI |
| `subscribe <uri>` | Subscribe to resource updates |
| `unsubscribe <uri>` | Unsubscribe from resource updates |
| `complete prompt <name> <arg> [val]` | Get argument completions for a prompt |
| `complete resource <uri> <arg> [val]` | Get argument completions for a resource |
| `pick prompt <name> <arg>` | Interactive completion picker for prompts |
| `pick resource <uri> <arg>` | Interactive completion picker for resources |
| `loglevel <level>` | Change server logging level |
| `quit` | Exit the client |

---

## Testing Each Feature

### 1. Tools

List all tools (shown on connect). Call them with:

```
> call echo {"message": "Hello MCP!"}
> call get-sum {"a": 5, "b": 3}
> call get-tiny-image
> call get-env {"name": "PATH"}
```

### 2. Resources

Read static resources:

```
> read demo://resource/static/document/architecture.md
> read demo://resource/static/document/features.md
```

### 3. Prompts

The server exposes prompts you can explore:
- `simple-prompt` - Basic prompt
- `args-prompt` - Prompt with arguments
- `completable-prompt` - Prompt with autocompletable args
- `resource-prompt` - Prompt that references resources

### 4. Completions

Test argument autocompletion:

```
> complete prompt completable-prompt language py
> complete prompt completable-prompt language java
```

Interactive picker (arrow keys to navigate, Enter to select):

```
> pick prompt completable-prompt language
```

### 5. Logging

Change the server's log level:

```
> loglevel debug
> loglevel warning
> loglevel error
```

Then trigger logging:

```
> call toggle-simulated-logging
```

Valid levels: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`

### 6. Elicitation

Trigger a server-initiated form request:

```
> call trigger-elicitation-request
```

The client will prompt you to fill in form fields. Enter values at each prompt.

### 7. Sampling (LLM Requests)

Trigger the server to request an LLM completion:

```
> call trigger-sampling-request
```

With `--sampling` enabled, you'll see:
1. The full request (system prompt, messages, tools)
2. An approval prompt: `Approve this request? [Y/n]:`
3. The LLM response after approval

For auto-approval (trusted servers only):

```bash
npm start -- --url http://localhost:3001/mcp --sampling --approval-mode auto
```

### 8. Agentic Sampling (Tool Loop)

Test the full agentic loop where LLM can use tools:

```
> call trigger-agentic-sampling
```

This demonstrates:
1. Server sends sampling request with tools
2. LLM decides to use a tool
3. Client returns `stopReason: toolUse`
4. Server executes tool, sends continuation
5. Loop until final response

### 9. Roots

Start with roots to expose directories to the server:

```bash
npm start -- --url http://localhost:3001/mcp --roots "/workspace,/home/user/projects"
```

### 10. Resource Subscriptions

Subscribe to a resource and toggle simulated updates:

```
> subscribe demo://resource/static/document/features.md
Subscribed to: demo://resource/static/document/features.md

> call toggle-subscriber-updates
```

You'll see `[Subscription] Resource updated: <uri>` notifications when subscribed resources change.

To unsubscribe:

```
> unsubscribe demo://resource/static/document/features.md
```

### 11. List Changed Notifications

Test dynamic tool list updates using `toggle-dynamic-tool`:

```
> call toggle-dynamic-tool
```

Each call triggers a `notifications/tools/list_changed` notification. The client receives it and re-fetches the tool list:

```
[List Changed] Tools updated: echo, get-sum, toggle-dynamic-tool, ...
```

This demonstrates the server using `server.sendToolListChanged()` to notify clients when tools change at runtime.

---

## CLI Flags Reference

```bash
npm start -- [options]

Connection:
  --stdio "command args"      Connect via stdio (spawn server process)
  --url <url>                 Connect via HTTP

Capabilities:
  --sampling                  Enable sampling (requires ANTHROPIC_API_KEY)
  --approval-mode <mode>      ask (default) or auto
  --roots <paths>             Comma-separated paths to expose
  --log-level <level>         Initial logging level (default: info)

Instructions:
  --instructions "text"       Add custom instructions for sampling
  --no-server-instructions    Disable MCP server instructions
  --config <path>             Custom config file path
```

---

## Troubleshooting

**"No API key - using mock handler"**
- Set `ANTHROPIC_API_KEY` in `.env` file
- Or export it: `export ANTHROPIC_API_KEY=sk-ant-...`

**Connection refused**
- Ensure the server is running on the correct port
- Check firewall settings

**Elicitation/Sampling not working**
- Ensure you started with `--sampling` flag
- Check that capabilities are listed on connect
