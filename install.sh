#!/bin/sh
# Lore installer.
#
#   curl -fsSL https://raw.githubusercontent.com/veds260/lore/main/install.sh | sh
#
# Read it before you run it. It clones the repo, installs dependencies, starts a
# Postgres if it can, writes a local .env.local, creates the tables, and hands
# you a running app. It never asks for a password and never writes outside the
# directory it creates.

set -eu

DIR="${LORE_DIR:-lore}"
REPO="${LORE_REPO:-https://github.com/veds260/lore.git}"
BRANCH="${LORE_BRANCH:-main}"
MIN_NODE=20

say()  { printf '\n  %s\n' "$1"; }
step() { printf '  %s\n' "$1"; }
die()  { printf '\n  %s\n\n' "$1" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required. $2"
}

say "Installing Lore"

need git "Install it from https://git-scm.com"
need node "Install Node $MIN_NODE or newer from https://nodejs.org"
need npm "It ships with Node. Reinstall Node from https://nodejs.org"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  die "Node $MIN_NODE or newer is required. You have $(node -v)."
fi

if [ -e "$DIR" ]; then
  die "$DIR already exists here. Move it, or run again with LORE_DIR=somewhere-else."
fi

step "cloning into $DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR" >/dev/null 2>&1 \
  || die "Could not clone $REPO. If the repository is private, sign in to git first."
cd "$DIR"

step "installing dependencies, this is the slow part"
npm install --no-audit --no-fund >/dev/null 2>&1 || die "npm install failed. Run it again inside $DIR to see why."

step "writing .env.local and generating a signing secret"
npx --yes tsx scripts/predev.ts >/dev/null 2>&1 || true

# The database. Docker is the easy path; a local postgres is fine too.
DB_READY=no
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  step "starting postgres in docker"
  if docker compose up -d >/dev/null 2>&1; then
    i=0
    while [ "$i" -lt 30 ]; do
      if docker compose exec -T db pg_isready -U postgres -d lore >/dev/null 2>&1; then
        DB_READY=yes
        break
      fi
      i=$((i + 1))
      sleep 1
    done
  fi
elif command -v psql >/dev/null 2>&1; then
  step "using the postgres already running on this machine"
  createdb lore >/dev/null 2>&1 || true
  if psql -d lore -c 'select 1' >/dev/null 2>&1; then
    LOCAL_URL="postgresql://$(whoami)@localhost:5432/lore"
    if grep -q '^DATABASE_URL=' .env.local 2>/dev/null; then
      sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${LOCAL_URL}|" .env.local && rm -f .env.local.bak
    else
      printf 'DATABASE_URL=%s\n' "$LOCAL_URL" >> .env.local
    fi
    DB_READY=yes
  fi
fi

if [ "$DB_READY" = yes ]; then
  step "creating the tables"
  npm run db:push >/dev/null 2>&1 || DB_READY=no
fi

if [ "$DB_READY" = yes ] && [ "${LORE_RELAY:-}" != off ]; then
  step "connecting to the shared relay for free starter credits (LORE_RELAY=off skips this)"
  npm run --silent relay:connect 2>&1 | sed 's/^/  /' || true
fi

if [ "$DB_READY" != yes ]; then
  say "Lore is installed, but it has no database yet."
  step "Start one, then finish setup:"
  step ""
  step "  cd $DIR"
  step "  docker compose up -d      # or point DATABASE_URL at any postgres"
  step "  npm run setup"
  step "  npm run dev"
  printf '\n'
  exit 0
fi

say "Done. Starting Lore."
step "A link will print below. Open it once and the instance is yours."
printf '\n'

exec npm run dev
