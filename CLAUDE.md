# Skilljack Client

## Setup

After cloning or switching branches, build the local mcp-server-manager package before running the dev server:

```bash
cd packages/mcp-server-manager && npm run build
```

Then start the Electron app:

```bash
npm run electron:dev
```

## Project Structure

- `packages/mcp-server-manager` - Local package for MCP server management
- `src/electron` - Electron main process and preload scripts
- `src/renderer` - React frontend
