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
LOG="$(pwd)/.install.log"
: > "$LOG"
DB_READY=no
DB_WHY=""

# Prints the end of whatever the last command wrote, so a failure has a reason.
tail_log() {
  printf '\n'
  tail -n "${1:-12}" "$LOG" | sed 's/^/    /'
  printf '\n'
}

port_busy() {
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

DB_NAME="${LORE_DB_NAME:-lore}"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if port_busy 5432; then
    DB_WHY="Port 5432 is already taken by another program, probably a Postgres you already run, so the Docker database could not start. Stop that program and run docker compose up -d, or point DATABASE_URL in .env.local at an empty database on it."
  else
    step "starting postgres in docker"
    if docker compose up -d >>"$LOG" 2>&1; then
      i=0
      while [ "$i" -lt 30 ]; do
        if docker compose exec -T db pg_isready -U postgres -d lore >/dev/null 2>&1; then
          DB_READY=yes
          break
        fi
        i=$((i + 1))
        sleep 1
      done
      [ "$DB_READY" = yes ] || DB_WHY="The Docker database started but did not answer within 30 seconds. Run docker compose logs db to see why."
    else
      step "docker compose up failed:"
      tail_log
      DB_WHY="docker compose up -d failed, see the lines above."
    fi
  fi
elif command -v psql >/dev/null 2>&1; then
  if ! psql -d postgres -c 'select 1' >>"$LOG" 2>&1; then
    step "found psql, but could not reach a running postgres:"
    tail_log 4
    DB_WHY="psql is installed but no Postgres answered. Start it, or install Docker and run docker compose up -d."
  elif psql -d "$DB_NAME" -c 'select 1' >/dev/null 2>&1 && [ "${LORE_REUSE_DB:-}" != yes ]; then
    DB_WHY="Your local Postgres already has a database called $DB_NAME, and Lore will not write into a database it did not create. Run the installer again with LORE_DB_NAME=some_new_name, or with LORE_REUSE_DB=yes if that database really is for Lore."
  else
    if [ "${LORE_REUSE_DB:-}" = yes ]; then
      step "using the existing $DB_NAME database on your local postgres, as LORE_REUSE_DB=yes asked"
    else
      step "creating a database called $DB_NAME on the postgres already running here"
      createdb "$DB_NAME" >>"$LOG" 2>&1 || { tail_log 4; }
    fi
    if psql -d "$DB_NAME" -c 'select 1' >>"$LOG" 2>&1; then
      LOCAL_URL="postgresql://$(whoami)@localhost:5432/$DB_NAME"
      if grep -q '^DATABASE_URL=' .env.local 2>/dev/null; then
        sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${LOCAL_URL}|" .env.local && rm -f .env.local.bak
      else
        printf 'DATABASE_URL=%s\n' "$LOCAL_URL" >> .env.local
      fi
      DB_READY=yes
    else
      DB_WHY="Could not open the $DB_NAME database on your local postgres."
    fi
  fi
else
  DB_WHY="Neither Docker nor Postgres was found on this computer."
fi

if [ "$DB_READY" = yes ]; then
  step "creating the tables"
  if ! npm run db:push >>"$LOG" 2>&1; then
    step "creating the tables failed:"
    tail_log
    DB_READY=no
    DB_WHY="npm run db:push failed, see the lines above."
  fi
fi

if [ "$DB_READY" = yes ] && [ "${LORE_RELAY:-}" != off ]; then
  step "connecting to the shared relay (LORE_RELAY=off skips this)"
  npm run --silent relay:connect 2>&1 | sed 's/^/  /' || true
fi

if [ "$DB_READY" != yes ]; then
  say "Lore is installed, but it has no database yet."
  step "$DB_WHY"
  step "The full output is in $DIR/.install.log"
  step ""
  step "When the database is ready, finish setup:"
  step ""
  step "  cd $DIR"
  step "  docker compose up -d      # or point DATABASE_URL at any postgres"
  step "  npm run setup"
  step "  npm run dev"
  printf '\n'
  exit 0
fi

say "Done. Starting Lore."
step "Your browser opens to create your account. If it does not, use the link printed below."
printf '\n'

exec npm run dev
