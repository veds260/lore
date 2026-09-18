# Setting up Lore

Lore runs on your machine and uses an AI agent you already pay for. There is no Lore account, and your drafts and your database stay local. Model calls do not stay local: they go to Anthropic, OpenAI or OpenRouter, whichever one you connect, on your own CLI session or your own key. X lookups and voice can go through an optional shared relay when you have no key of your own for them, which is covered further down and easy to turn off.

If you get stuck at any point, run `npm run doctor`. It checks everything below and prints the exact command to fix whatever is missing.

---

## What you need first

- Node 20 or newer, with the npm that comes with it. `node -v` tells you.
- git.
- Postgres, or Docker to run one for you.

macOS and Linux run Lore as they are. On Debian and Ubuntu the packaged `nodejs` is usually too old, so install Node from [NodeSource](https://deb.nodesource.com) or [nvm](https://github.com/nvm-sh/nvm) rather than apt.

**Windows runs Lore directly.** Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/veds260/lore/main/install.ps1 | iex
```

That checks Node, clones, installs, finds a Postgres, creates the tables and starts the app, and it asks before installing anything. When Node is missing it offers `winget install OpenJS.NodeJS.LTS`. For the database it takes Docker Desktop if the engine is running, otherwise the PostgreSQL service if you have one, otherwise it tells you to run `winget install --id PostgreSQL.PostgreSQL.16` and come back. A Postgres installed that way wants the password you set for the `postgres` user, and the installer asks for it rather than guessing. Every command further down this guide works the same in PowerShell, `docker compose up -d` and `npm run dev` included.

Two Windows details worth knowing. A global npm install puts `claude` and `codex` in `%APPDATA%\npm` as `.cmd` shims, and Lore looks there and starts them through `cmd.exe`, which is the only way Node will run a shim. Starting a PostgreSQL service that is installed but stopped needs an administrator prompt, and the installer says so instead of failing quietly.

**WSL2 is the other way**, if you would rather have a Linux shell. Run `wsl --install` in an administrator PowerShell, restart, then follow the macOS and Linux instructions inside the Ubuntu terminal. Keep the clone on the Linux side, somewhere under `~`, because npm installs on `/mnt/c` are slow enough to feel broken. Lore there opens your normal Windows browser through `wslview` when the `wslu` package is installed, and `cmd.exe /c start` otherwise.

---

## The five minute version

```bash
git clone https://github.com/veds260/lore.git
cd lore
npm install
cp .env.example .env.local

# a database to keep your drafts in, matching the DATABASE_URL already in .env.local
docker compose up -d
npm run db:push

npm run doctor   # should say "Lore is ready"
npm run dev      # your browser opens on the setup page
```

That is the whole required setup. Everything after this point is optional.

---

## Step 1: give Lore a model

Lore needs something to think with. Two ways, and the first one costs nothing extra.

### A. Use the agent CLI you already have (recommended)

If you have Claude Code or Codex installed and signed in, Lore will find it and use it. No API key, no per-token billing, it runs on the subscription you already pay for.

```bash
claude auth login   # Claude plan, opens a browser sign-in
codex login         # or ChatGPT plan, same idea
npm run doctor      # should now say: Claude Code (claude) or Codex (codex)
```

You can also skip the terminal: the setup page shows whether each one is installed and signed in, and has a Sign in button that runs the same login for you.

Lore shells out to the CLI for each request. Nothing is sent anywhere else.

### B. Use an API key

If you would rather pay per token, or you want image features, paste a key on the setup page. It is tested with a real call and saved to `.env.local` only if it works. Or put one of these in `.env.local` yourself:

```
ANTHROPIC_API_KEY=sk-ant-...
# or OPENAI_API_KEY=sk-...
# or OPENROUTER_API_KEY=sk-or-...
```

With both a CLI and a key available, pick one on the setup page, or pin it with `LORE_PROVIDER=claude`, `codex` or `api`. Without a choice, a key wins because setting one is deliberate.

### Which one should you pick

| | Agent CLI | API key |
|---|---|---|
| Extra cost | none, uses your subscription | per token |
| Setup | sign in once | paste a key |
| Image features | not available | available |
| Speed | a little slower per call | a little faster |

Image features are the only real gap. Lore tells you when something is off rather than failing quietly, and it will use a key just for images if you have both.

---

## Step 2: give Lore a database

Your drafts, voice profile, interviews and history live here. Postgres, local or hosted, your choice.

**Local.** With Docker, from the Lore folder:
```bash
docker compose up -d
```
That matches this line in `.env.local`:
```
DATABASE_URL=postgresql://postgres:lore@localhost:5432/lore
```
Without Docker, install Postgres however your system likes to:

```bash
brew install postgresql@16 && brew services start postgresql@16   # macOS
sudo apt-get install -y postgresql && sudo service postgresql start   # Debian, Ubuntu, WSL2
sudo dnf install -y postgresql-server && sudo postgresql-setup --initdb && sudo systemctl enable --now postgresql   # Fedora
sudo pacman -S postgresql   # Arch
winget install --id PostgreSQL.PostgreSQL.16   # Windows
```

On macOS [Postgres.app](https://postgresapp.com) is the no-terminal version of the same thing. A fresh Linux install has no role for your user yet, so make one with `sudo -u postgres createuser -s $(id -un)` before anything else. Then create an empty database with `createdb lore`, or `psql -d postgres -c 'create database lore'` if `createdb` is not there, and point `DATABASE_URL` at it, for example `postgresql://yourname@localhost:5432/lore`.

**Hosted:** any Postgres works. Neon, Supabase and Railway all have free tiers. Copy their connection string into `DATABASE_URL`.

Then create the tables:
```bash
npm run db:push
```

---

## Step 3 (optional): Telegram

Lets you talk to Lore from your phone and have drafts pushed to you.

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts.
2. Put the token in `.env.local` as `TELEGRAM_BOT_TOKEN`.
3. Start the worker so the bot is listening: `npm run worker`
4. Pair the bot to your Telegram account:

```bash
npm run telegram:pair
```

It prints a six digit code. Send that code to your bot, and the script confirms when it lands.

This step is not optional housekeeping. Your bot has a public @username, so an unpaired bot would answer anyone who found it, using your Lore. Until a chat is paired, the bot talks to nobody. Once paired, it only ever talks to you, and a stranger messaging it gets silence rather than a reply telling them the bot is alive.

To move Lore to a different Telegram account: `npm run telegram:pair -- --reset`

5. Pick a transport:

**Running locally: use polling.** No public URL needed, nothing to expose.
```bash
npm run worker
```
The worker long-polls Telegram and remembers its place, so a restart never replays messages you already handled.

**Hosted: use a webhook.** Faster and cheaper to run.
```bash
# in .env.local
NEXT_PUBLIC_APP_URL=https://your-domain.com
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)

npm run telegram:register
```

Use one or the other. Telegram will not deliver to a webhook and a poller at the same time, so if messages stop arriving, that is usually why.

---

## Step 4 (optional): voice interviews

Lore can interview you out loud instead of by typing, which tends to get better material out of you and faster.

Voice interviews need [Fish Audio](https://fish.audio) for speech and [Groq](https://console.groq.com) for transcription. Set `FISH_AUDIO_API_KEY` and `GROQ_API_KEY` in `.env.local`, or use the shared relay below.

---

## The shared relay (optional)

If you have not set `TWITTERAPI_IO_KEY`, `FISH_AUDIO_API_KEY` or `GROQ_API_KEY`, Lore can make those calls through a shared relay run by the maintainer, on limited free credits. A credit is about a tenth of a cent of real cost, so bigger calls use more. The keys stay on the relay.

```bash
npm run relay:connect   # connects this install to the relay
```

The credits start locked. Open `/setup`, go to Extras and pick Shared relay. Star the repo and confirm it by signing in to GitHub with the code shown, then follow [@vedsayys](https://x.com/vedsayys) on X and put the code it gives you in your bio or a post. You can remove the code once it says verified. Free credits need accounts that are at least 30 days old, and the X account needs 10 followers and 10 posts. Each account unlocks once, and reinstalling carries over what was left. The key is saved in your database, or you can set `LORE_RELAY_KEY` yourself.

Your own keys always take priority. The relay sees X handles and search queries, the text being spoken, voice answers while they are transcribed, and your relay key, and never your drafts, database or prompts. To switch it off, put `LORE_RELAY=off` in `.env.local`.

---

## Deploying it somewhere

Lore is a normal Next.js app plus a worker process.

**Railway** is the path of least resistance: create a project from the repo, add a Postgres plugin, set `DATABASE_URL` and `AUTH_SECRET` (`openssl rand -base64 32`), and deploy. Add a second service running `npm run worker` if you want Telegram and scheduled jobs.

Note that a hosted Lore cannot use your local agent CLI, because the CLI is on your laptop. Hosted installs need an API key. This is the main reason to run Lore locally.

---

## When something is wrong

Run `npm run doctor` first. It names the problem and the fix.

**"No model backend available"**
Neither a CLI nor a key was found. Install Claude Code and sign in, or set an API key.

**"claude is installed but not signed in"**
Run `claude` in a terminal, sign in, quit, try again. Expired logins look the same as missing ones.

**Database connects but pages error**
The tables are probably missing. Run `npm run db:push`.

**Telegram bot goes quiet**
You likely have both a webhook and the poller configured. Pick one. `npm run telegram:register -- --delete` clears the webhook so polling can take over.

**Image features are off**
Expected when using a CLI. Add an API key if you want them.

**Your browser does not open on first run**
The link is printed in the terminal, so open that by hand. On a plain Linux desktop Lore uses `xdg-open`, which comes from the `xdg-utils` package. On Windows it runs `cmd /c start` and falls back to `Start-Process`, and inside WSL2 it tries `wslview` from `wslu` first and then `cmd.exe`. Over ssh nothing opens at all, which is deliberate.

**The setup page says Claude Code is not installed and you know it is**
Lore looks on `PATH` and in `~/.local/bin`, `~/bin`, `~/.claude/local`, `~/.bun/bin`, `~/.npm-global/bin`, `/usr/local/bin` and Homebrew. If yours is somewhere else, either add that directory to `PATH` before starting Lore, or symlink the binary into `~/.local/bin`.
