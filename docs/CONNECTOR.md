# Driving Lore from Claude

Lore runs an MCP server over stdio, so any MCP client can use it. The server talks
straight to your local database and model backend, which means it inherits whatever
`npm run doctor` already reports and sends nothing to anyone else.

## Add it

Claude Code:

```bash
claude mcp add lore -- npm --prefix /path/to/lore run mcp
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lore": {
      "command": "npm",
      "args": ["--prefix", "/path/to/lore", "run", "mcp"]
    }
  }
}
```

Use the absolute path to wherever you installed Lore. The server loads `.env.local`
from that directory itself, so it needs no environment of its own.

Check it is alive:

```bash
npm run mcp < /dev/null
```

A working server prints nothing and waits. Anything else is an error worth reading.

## What it can do

| Tool | What it does |
|---|---|
| `list_brands` | the brands on this instance, and which one is active |
| `get_voice` | the voice summary plus every rule learned from your edits |
| `list_drafts` | what is on the board, filterable by status |
| `generate_post` | writes a draft in the brand's voice, without saving it |
| `save_idea` | parks an idea on the board for later |

Every tool takes an optional `brand`, by name or handle. Leave it out and the active
brand is used.

## Which account it acts as

The owner. `ADMIN_EMAIL` decides that when it is set, otherwise the oldest account
on the instance, which on a single-user install is the account that claimed it.

## Scope

The server is local and unauthenticated by design: anything that can run the command
can already read `.env.local`. Do not expose it over a network. If you want Lore
reachable from elsewhere, put the HTTP app behind your own auth instead.

`generate_post` spends model calls, so it costs whatever your backend costs. The
other four only read or write your own database.
