# Security

## Reporting a problem

Do not open a public issue. Use GitHub's private advisory form on this repository
(Security → Report a vulnerability), which reaches the maintainer directly.

Expect a first reply within a few days. Once a fix is out you get credit in the
release notes unless you would rather not be named.

## What Lore assumes

**Whoever holds the terminal owns the instance.** First run prints a setup link on
stdout and opens it in a local browser. Anyone who can read that output can create
the owner account, which is the same trust level as being able to read `.env.local`.
On a shared host, create the account before exposing the port.

**Passwords are hashed with scrypt** and never stored or logged in plain text. Failed
sign-ins are limited to ten per email and address in fifteen minutes.

**`/setup` is public only while the instance is unowned.** After that it requires a
session. A fresh deploy left running on a public URL with nobody claiming it is the
one state worth avoiding.

**Third-party text reaches the model.** Lore reads posts, threads and pages that
strangers wrote, and puts them in prompts. Treat model output as untrusted: it is
parsed and validated, never executed. When the CLI provider is used, the agent runs
with tools switched off (`--tools ''` for Claude Code, `--sandbox read-only`
for Codex) and with a scrubbed environment that excludes `DATABASE_URL`, `AUTH_SECRET`
and every API key. Do not relax those flags to "fix" a prompt that wants to read a
file.

**Secrets live in the environment, never the database or the client.** Anything
prefixed `NEXT_PUBLIC_` is shipped to the browser, so nothing sensitive goes there.

**The shared relay sees a little, and only when you use it.** Installs without their
own X, Fish Audio or Groq keys call a relay run by the maintainer. It receives the X
handles and search queries being looked up, the text sent for speech, voice answers
sent for transcription, and the
install's relay key, which is stored in the `instance_settings` table or in
`LORE_RELAY_KEY`. It never receives drafts, the database or model prompts. Setting
your own keys keeps those calls off the relay, and `LORE_RELAY=off` disables it.

**Nothing posts publicly on its own.** Drafts wait for approval. The background agent
stays off unless `AGENT_ENABLED` is exactly `true`, and it holds a per-brand daily cap
so a loop cannot run up a bill.

## Supported versions

The `main` branch gets fixes. There are no long-term support branches yet.
