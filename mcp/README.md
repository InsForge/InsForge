# Insforge MCP Server

Model Context Protocol server for Insforge - part of the Insforge monorepo.

## Installation

From the root directory:
```bash
npm install
cd mcp
npm run build
```

## Usage

```bash
# With API key as argument
node dist/index.js --api_key YOUR_API_KEY

# Or with environment variable
API_KEY=your-key node dist/index.js
```

## Available Tools

- **Database**: `create-table`, `modify-table`, `delete-table`, `get-table-schema`
- **Storage**: `create-bucket`, `list-buckets`, `delete-bucket`
- **Docs**: `get-instructions`, `debug-backend`, `get-db-api`, `get-auth-api`, `get-storage-api`

## Integration

### Claude Code CLI (Recommended)

For local development with Claude Code:

1. **Start your Insforge backend server locally:**
```bash
# From the backend directory
docker compose up
# Server will run on http://localhost:7130
```

2. **Add the MCP server to Claude Code:**
```bash
# From the InsForge root directory
claude mcp add insforge -- npx tsx mcp/src/index.ts --api_key YOUR_API_KEY

# Verify installation
claude mcp list
```

The MCP server will automatically connect to your local backend at `http://localhost:7130` when Claude Code starts a new session.

To remove:
```bash
claude mcp remove insforge
```

### Claude Desktop

Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "insforge": {
      "command": "node",
      "args": ["/path/to/InsForge/mcp/dist/index.js", "--api_key", "YOUR_KEY"]
    }
  }
}
```

## Development

```bash
npm run dev    # Watch mode
npm run build  # Production build
```

Part of [Insforge](https://github.com/InsForge/insforge).