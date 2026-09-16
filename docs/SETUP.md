# Setting up Lore

Lore runs on your machine and uses an AI agent you already pay for. There is no Lore account, and your drafts, database and model calls stay local. If you skip your own X, Fish Audio or Groq keys, those calls can go through an optional shared relay instead, which is covered further down and easy to turn off.

If you get stuck at any point, run `npm run doctor`. It checks everything below and prints the exact command to fix whatever is missing.

---

## The five minute version

```bash
git clone https://github.com/veds260/lore.git
cd lore
npm install
cp .env.example .env.local

# a database to keep your drafts in
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=lore --name lore-db postgres:16
echo 'DATABASE_URL=postgresql://postgres:lore@localhost:5432/postgres' >> .env.local
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
claude          # run once, sign in, then quit
npm run doctor  # should now say: Claude Code (claude)
```

Lore shells out to the CLI for each request. Nothing is sent anywhere else.

### B. Use an API key

If you would rather pay per token, or you want image features, put one of these in `.env.local`:

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

**Local.** With Docker:
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=lore --name lore-db postgres:16
```
Without Docker, [Postgres.app](https://postgresapp.com) on macOS or `brew install postgresql@16` both work the same way.

Then in `.env.local`:
```
DATABASE_URL=postgresql://postgres:lore@localhost:5432/postgres
```

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
NEXT_PUBLIC_APP_URL=https://your-lore.up.railway.app
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

## Step 5 (optional): webhooks

Push Lore events into n8n, Make, Zapier, Slack or your own service the moment they happen. See [WEBHOOKS.md](./WEBHOOKS.md) for the full guide.

```bash
echo "LORE_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env.local
```

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
