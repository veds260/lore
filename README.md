# Lore

Lore reads the last 90 days of your posts before it writes anything, learns how you
actually write, and turns every edit you make into a rule it will not break again.

It runs on your machine, against an AI agent you already pay for, and there is no
Lore account. Your drafts and your database stay on your machine. Model calls leave it,
because the model is not local: they go to Anthropic, OpenAI or OpenRouter, whichever
one you connect, through your own CLI session or your own key, and they are billed and
logged under your account there. X lookups and voice go through a shared relay when you
have not set your own X, Fish Audio or Groq keys, on limited free credits, and
`LORE_RELAY=off` turns that off. Lore never posts for you. Every draft has a Post on X button that opens X with the text filled in,
and you press send.

macOS, Linux and Windows all run it. You need Node 20 or newer and either Docker or
a Postgres you can point it at.

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/veds260/lore/main/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/veds260/lore/main/install.ps1 | iex
```

That clones the repo, installs it, starts a Postgres if it can, writes the env
file, creates the tables and boots the app. Your browser then opens on a setup page
where you create your account and connect a model, one step at a time.

Read the installer first if you would rather not pipe a script into a shell. The
long way round is the same thing by hand, and the commands are identical on all
three systems:

```bash
git clone https://github.com/veds260/lore.git && cd lore
npm install
docker compose up -d
npm run setup
npm run dev
```

If anything is missing, `npm run doctor` says what and gives you the exact command.

---

## What it does

**It starts from your real writing.** Connect a handle and Lore pulls your posts and
their public numbers, works out your voice from the evidence, and tells you something
true about your own posting before it writes a word.

**Your edits become rules.** Change a draft and Lore reads the pattern behind the
change rather than the words. After a couple of similar edits it writes the rule down
and applies it to everything after, with a strength score and a count of the posts it
has touched.

**It measures the shape of your writing.** Sentence rhythm, how often you break a
line, how often you go lowercase. Drafts get reflowed until they match your numbers
instead of the model's.

**It comes to you.** An optional Telegram bot sends a morning brief with your own
numbers in it, takes plain-language replies, and drafts on request. On a quiet day it
says nothing, because an invented insight is worse than none.

## What it needs

**Node 20 or newer, on any of the three.** On Windows `install.ps1` offers to fetch
it with `winget install OpenJS.NodeJS.LTS` when it is missing, and finds Claude Code
and Codex where npm puts them on Windows, in `%APPDATA%\npm`. WSL2 still works if you
would rather have a Linux shell: run `wsl --install` in an administrator PowerShell,
restart, and use the `install.sh` line inside Ubuntu.

**A database.** `docker compose up -d` gives you one. Any Postgres works.

**A model backend.** Two ways, and the first costs nothing beyond what you already pay:

| | Agent CLI | API key |
|---|---|---|
| Setup | install Claude Code (Claude plan) or Codex (ChatGPT plan) and sign in | paste a key on the setup page |
| Cost | included in your subscription | per use, billed by the provider |
| Images | no | yes |
| Speed | slower, it spawns a process | faster |

The setup page checks whether Claude Code and Codex are installed and signed in. If
one is installed but signed out, the Sign in button opens the normal Claude or ChatGPT
login in your browser. If neither is installed, it shows the one command to install
it. An Anthropic, OpenAI or OpenRouter key pasted there is tested with a real call and
saved to `.env.local` only if it works. Whatever you pick gets a short test message
before you can move on. Posts generated this way have no limits from Lore, only
whatever your own plan allows. Set `LORE_PROVIDER` to `claude`, `codex` or `api` to
pin a choice in `.env.local` instead.

Everything else is optional and degrades quietly when it is absent: Telegram, X
lookups, voice interviews. The setup page lists what each one turns on.

## Shared relay

X lookups and voice interviews normally need keys from twitterapi.io, Fish Audio and
Groq. So you can try them first, the maintainer runs a small relay that makes those
calls for each install on a limited number of free credits. Credits follow what a
call really costs, so a long voice clip uses more than a profile lookup, and the keys
themselves never leave the relay.
The installer connects your install to the relay, unless you run it with
`LORE_RELAY=off`, and its credits start locked. To unlock the 200 starter credits, open Shared
relay under Extras on the setup page, follow [@vedsayys](https://x.com/vedsayys) on X
and put the short code it gives you in your X bio or a post, so the relay knows the
account is yours. The page may also ask you to star this repo and confirm it through
GitHub sign-in. The X account needs to be at least 30 days old with 10 followers and
10 posts. Each account unlocks free credits once, so a reinstall carries over what
was left rather than starting again.

Your own key always wins. Set `TWITTERAPI_IO_KEY`, `FISH_AUDIO_API_KEY` or
`GROQ_API_KEY` and that feature stops using the relay. The relay only ever sees X
handles and search queries, the text being spoken, your voice answers while they are
transcribed, and your install's relay key. It never sees drafts,
your database or model prompts. Set `LORE_RELAY=off` in `.env.local` to switch it off
completely, and remove that line and restart Lore to turn it back on.

## Drive it from Claude

Lore ships an MCP server, so Claude can read your voice and write in it without
you leaving the chat.

```bash
claude mcp add lore -- npm --prefix /path/to/lore run mcp
```

Claude Desktop wants the same thing in its config file instead:

```json
{
  "mcpServers": {
    "lore": { "command": "npm", "args": ["--prefix", "/path/to/lore", "run", "mcp"] }
  }
}
```

It exposes five tools: `list_brands`, `get_voice`, `list_drafts`, `generate_post`
and `save_idea`. The server talks to your local database directly and inherits whatever
this install already has configured, so `generate_post` goes to the same model provider
the app uses and nothing else leaves the machine. `docs/CONNECTOR.md` has the detail.

## Sign-in

First run opens a one-time link where you create the owner account with an email and
password. The link stops working the moment it is used, and after that you sign in at
`/login`. Forgot the password? `npm run password:reset` sets a new one.

If you want email links or Google sign-in too, set `RESEND_API_KEY` plus `LORE_MAIL_FROM`
on a domain you have verified, or `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## Running it on a server

Set `NEXT_PUBLIC_APP_URL` to the real origin, put a strong `AUTH_SECRET` in place,
and create the owner account straight after the first deploy, since the setup link is
printed to the server log rather than opened in a browser. Set `CRON_SECRET` if you
want the scheduled jobs, and `AGENT_ENABLED=true` only when you actually want the
background agent spending model calls.

The `/setup` page stops being public the moment the instance has an owner.

`npm run dev` only listens on this computer (127.0.0.1), so nobody else on your
network can reach a fresh install before you claim it. Start it with
`LORE_HOST=0.0.0.0 npm run dev` if you do want it reachable from other devices.

## Layout

```
app/            routes. (app) is signed-in, (marketing) is public, /setup is the wizard
lib/providers/  how Lore talks to a model: CLI, API key, or relay
lib/setup/      one capability registry behind both `npm run doctor` and /setup
lib/db/         drizzle schema
worker/         the background agent: briefs, scheduling, Telegram
mcp/            the MCP server that Claude connects to
docs/           SETUP.md and CONNECTOR.md
```

## Commands

```bash
npm run dev             # http://localhost:3000
npm run doctor          # what is configured, what is missing, how to fix it
npm run db:push         # apply the schema
npm run db:studio       # browse the data
npm run worker          # the background agent, off unless AGENT_ENABLED=true
npm run telegram:pair   # link a Telegram chat to a brand
npm run relay:connect   # connect to the shared relay
npm run password:reset  # set a new password for an account
npm run mcp             # the MCP server, for Claude and other MCP clients
npm test                # unit tests
```

## Contributing

Issues and pull requests are welcome. `CONTRIBUTING.md` covers the setup and what a
good change looks like. To report a security problem, read `SECURITY.md` first and
do not open a public issue.

## Licence

AGPL-3.0. Use it, change it, self-host it. If you run a modified Lore as a service
for other people, publish your changes. See `LICENSE`.
