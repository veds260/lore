# Contributing

## Getting set up

```bash
npm install
docker compose up -d
cp .env.example .env.local
npm run db:push
npm run doctor      # should say everything required is ready
npm run dev
```

`npm run doctor` is the fastest way to find out why something is not working. It
checks the same things the `/setup` page does.

## Before you open a pull request

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

CI runs all four. A change that fails any of them will not merge.

## What makes a change easy to accept

Keep the diff about one thing. A bug fix and a refactor in the same pull request take
three times as long to review.

Add a capability to `lib/setup/checks.ts` when you add anything that needs
configuration. That single registry feeds both `npm run doctor` and the setup page,
so a new env var that is not registered there is invisible to the people who have to
set it up.

Go through `lib/providers` rather than calling a model directly. Call sites ask for a
role, and the provider decides what that means for the backend in front of it. A
hardcoded model string breaks everyone running on a CLI.

Never widen the CLI sandbox. Those flags are load-bearing, and `SECURITY.md` explains
why.

Write the user-facing strings the way a person talks. Short words, no em dashes, no
exclamation marks, and an error should say what went wrong and what to type next.

## Things worth doing

Look for issues tagged `good first issue`. Beyond that, the places that most need
help are more model backends in `lib/providers`, more platforms beyond X and
LinkedIn, and tests around the learning loop.
