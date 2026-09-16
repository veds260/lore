# Lore agent worker

The proactive layer: per-brand morning briefs and evening wraps on a staggered schedule, a Telegram chat that drafts in the brand voice, conversational onboarding, and hard budget caps. Runs as a second process on the same repo and the same Postgres. Reuses the existing generation stack (`lib/briefs.ts`, `lib/telegram-generate.ts`, `lib/bootstrap-voice.ts`); the worker only adds scheduling, tenancy, onboarding, and guardrails.

## Run

```
npm run worker
```

Exits immediately unless `AGENT_ENABLED=true`. On a host, run it as a second service with start command `npm run worker` and the same env vars as the web app.

## Env

| var | default | meaning |
|---|---|---|
| `AGENT_ENABLED` | off | must be exactly `true` for the worker to start |
| `DATABASE_URL` | required | same Postgres as the app |
| `TELEGRAM_BOT_TOKEN` | required | the bot the agent speaks through |
| model backend | required | same as the app: an agent CLI, or an API key. With a key, use a dedicated one with a provider-side spend cap |
| `TWITTERAPI_IO_KEY` | required | tape ingestion for onboarding |
| `AGENT_TAKEOVER_TELEGRAM` | off | `true` deletes the Next app's webhook so the worker can long-poll the bot. Without it, if a webhook exists the worker runs scheduler-only |
| `AGENT_TZ` | `UTC` | timezone the brief hours are interpreted in |
| `AGENT_DAILY_OPS_CAP` | 20 | per-brand daily budget; every brief, wrap, or draft consumes 1 |
| `AGENT_MODEL_CONCURRENCY` | 3 | global cap on concurrent model-heavy operations |
| `AGENT_ACTIVE_START` / `AGENT_ACTIVE_END` | 8 / 22 | the heartbeat guardrail: no proactive message outside this local-hour window, regardless of per-chat settings |

## Tenancy model

One Telegram chat drives exactly one brand, via `agent.chat_bindings(chat_id -> user_id + brand_id)`. The binding is created only by an explicit choice in onboarding (or auto-seeded when a linked user owns exactly one active brand; people with several brands always pick by hand). There is no "current brand" state anywhere in the worker, every function takes the ids as arguments, and every proactive message carries a `▸ brand` tag so a wrong binding is visible in chat the same day. Worker state lives in its own `agent` Postgres schema, created idempotently at boot, invisible to drizzle-kit.

## Spend control, outermost first

1. Provider spend cap on the dedicated API key (the only true hard stop).
2. `agent.spend`: atomic per-brand daily counter; over cap means the operation never runs.
3. Global semaphore on model calls.
4. `agent.ritual_log`: claim-based idempotency so restarts, crashes, or a second replica can't double-send.
5. `AGENT_ENABLED` kill switch, default off.

## Onboarding flow

/start -> pick brand (or send @handle) -> worker pulls the real posting history and answers with the person's own numbers (90-day baseline, breakout post and its multiple) -> one goal question, saved into the brand brief -> brief hour -> done, with "brief now" as the try-now. When there is no usable tape it says so and interviews instead of faking a voice.

## What the chat can do

Free text goes through the real agent loop (lib/telegram-agent): park ideas, draft posts, show and list what's queued, or just answer, with rolling history as context. Drafts report the LinkedIn shape used and how long they took, and every draft message reminds the user that edits teach rules. `/voice` shows the current read of the brand voice plus the latest learned rules. The evening wrap appends "people who dropped by today" (reply authors on the day's posts, largest accounts first) when there is anyone real to show, and the onboarding wow message adds a day-of-week performance fact when 90 days of data actually supports one. Onboarding renders a checklist message that gets edited with strike-marks as the conversation covers each step.

## Plugins

Any file in `worker/plugins/` other than `index.ts` and `types.ts` is loaded at boot as a plugin. A plugin's default export can add `/help` lines, handle chat messages, own an onboarding step, create its own tables in `init`, and run a daily job through `ctx.runRitual`, which uses the same budget, active-hours window and once-per-day claim as the built-in brief. See `worker/plugins/types.ts` for the interface.

## Scale path

Single process handles hundreds of brands (the model-call semaphore is the ceiling, not the event loop). When one process is not enough: the claim-based ritual log already makes a second replica safe for scheduled sends; move chat handling behind a queue (pg-boss on the same Postgres) at that point, not before.
