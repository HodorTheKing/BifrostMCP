# Bifrost MCP Migration: SSE → Streamable HTTP

This document describes the migration from SSE transport to Streamable HTTP transport.

## Why Migrate?

The Model Context Protocol (MCP) has deprecated the HTTP+SSE transport in favor of **Streamable HTTP**. This new transport:
- Consolidates endpoints (single `/mcp` instead of `/sse` + `/message`)
- Supports better session management via HTTP headers
- Is the standard for MCP protocol version 2025-06-18+

## Changes Made

### 1. Dependencies Updated

**package.json:**
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "@modelcontextprotocol/node": "^1.6.1",  // NEW
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "cors": "^2.8.5",
    "express": "^5.0.1"
  }
}
```

### 2. Transport Changed

**Before (SSE):**
```typescript
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const transports: { [sessionId: string]: SSEServerTransport } = {};

app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/message', res);
    // ... handle session
});

app.post('/message', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    await transport.handlePostMessage(req, res, req.body);
});
```

**After (Streamable HTTP):**
```typescript
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node/streamable-http.js';

const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
});

await mcpServer.connect(transport);

// Single endpoint for both GET and POST
app.post('/mcp', async (req, res) => {
    await transport.handleRequest(req, res, req.body);
});
```

### 3. Endpoint Changes

| Endpoint | Old (SSE) | New (Streamable HTTP) |
|----------|-----------|----------------------|
| Main | `/sse` + `/message` | `/mcp` |
| Health | `/health` | `/health` (updated) |

### 4. Client Configuration

**Goose Configuration:**

**Before (SSE):**
```yaml
extensions:
  bifrost:
    type: sse
    uri: http://localhost:8008/sse
```

**After (Streamable HTTP):**
```yaml
extensions:
  bifrost:
    type: streamable_http
    name: bifrost
    uri: http://localhost:8008/mcp
    timeout: 300
```

**Cursor/Cline/Roo Configuration:**

**Before (SSE):**
```json
{
  "mcpServers": {
    "Bifrost": {
      "url": "http://localhost:8008/sse"
    }
  }
}
```

**After (Streamable HTTP):**
```json
{
  "mcpServers": {
    "Bifrost": {
      "url": "http://localhost:8008/mcp",
      "type": "streamable_http"
    }
  }
}
```

## Installation Steps

### 1. Clone and Checkout

```bash
git clone https://github.com/HodorTheKing/BifrostMCP.git
cd BifrostMCP
git checkout streamable-http-migration
```

### 2. Update Dependencies

```bash
# Delete node_modules and package-lock.json to ensure clean install
rm -rf node_modules package-lock.json

# Install dependencies (this will install @modelcontextprotocol/node)
npm install
```

### 3. Build

```bash
npm run compile
```

### 4. Package (for distribution)

```bash
vsce package
```

### 5. Install in VS Code

```bash
code --install-extension bifrost-mcp-0.0.15.vsix
```

### 6. Configure Your MCP Client

Update your MCP client configuration to use `type: streamable_http` and URL ending in `/mcp`:

**Goose CLI:**
```bash
goose configure
# Select: Add Extension → Remote Extension → Streaming HTTP
# Name: bifrost
# URL: http://localhost:8008/mcp
# Timeout: 300
```

**Goose Desktop:**
- Open menu → Extensions → Add custom extension
- Select "Add custom extension"
- Select "Streaming HTTP (single endpoint)"
- Name: `bifrost`
- URL: `http://localhost:8008/mcp`

**Cursor/Cline:**
```json
{
  "mcpServers": {
    "bifrost": {
      "type": "streamable_http",
      "url": "http://localhost:8008/mcp"
    }
  }
}
```

## Backwards Compatibility

The migration includes backwards compatibility endpoints:

- `/sse` - Returns `410 Gone` with migration message
- `/message` - Returns `410 Gone` with migration message
- `/health` - Updated to show transport status and migration guidance

If your client is still using the old endpoints, it will receive helpful error messages directing it to the new `/mcp` endpoint.

## Troubleshooting

### 410 Errors

If you see `410 Gone` responses, your client is still using the old SSE transport. Update the client configuration as shown above.

### "Cannot find module '@modelcontextprotocol/node'"

Make sure you ran `npm install` after checking out the branch. You may need to:
```bash
rm -rf node_modules
npm install
```

### Port Already in Use

If the server fails to start, check if another process is using the port:

```bash
# Windows
netstat -ano | findstr 8008

# macOS/Linux
lsof -i :8008
```

### Build Errors

If you get build errors, ensure:
1. **Dependencies are installed** - `npm install`
2. **TypeScript version compatible** - `npx tsc --version`
3. **No conflicting packages** - Delete `node_modules` and reinstall

## Testing

### 1. Start VS Code with Extension

Open a project with the extension loaded.

### 2. Verify Server Started

Check VS Code output panel - should see:
```
MCP Server (Streamable HTTP) listening on http://localhost:8008
```

### 3. Test Health Endpoint

```bash
curl http://localhost:8008/health
```

Expected response:
```json
{
  "status": "ok",
  "transport": "streamable-http",
  "endpoints": {
    "mcp": "/mcp",
    "deprecated": ["/sse", "/message"]
  }
}
```

### 4. Test MCP Client Connection

Connect your MCP client (Goose, Cursor, etc.) with the new configuration.

## Important Notes for Goose Users

Goose **requires** the use of `streamable_http` transport type. The error:
```
Failed to add extension: invalid config: SSE is unsupported, migrate to streamable_http
```

means exactly what it says - SSE is deprecated in Goose. You **must** use the Streamable HTTP configuration:

```yaml
extensions:
  bifrost:
    enabled: true
    type: streamable_http  ← NOT 'sse'
    name: bifrost
    uri: http://localhost:8008/mcp  ← NOT '/sse'
```

## Support

For issues with this migration:
1. Check the [MCP Documentation](https://modelcontextprotocol.io/docs/concepts/transports)
2. Review the [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/)
3. Open an issue on the [GitHub repository](https://github.com/HodorTheKing/BifrostMCP/issues)

## Migration Timeline

- **Now**: Both SSE and Streamable HTTP available (SSE marked as deprecated)
- **Future**: SSE endpoints will be removed in a future major version

## References

- [MCP Transports Documentation](https://modelcontextprotocol.io/docs/concepts/transports)
- [NodeStreamableHTTPServerTransport API](https://ts.sdk.modelcontextprotocol.io/v2/classes/_modelcontextprotocol_node.streamableHttp.NodeStreamableHTTPServerTransport.html)
- [MCP SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk)
- [Goose MCP Support](https://block.github.io/goose/)
