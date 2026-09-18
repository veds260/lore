#!/bin/sh
# Lore installer.
#
#   curl -fsSL https://raw.githubusercontent.com/veds260/lore/main/install.sh | sh
#
# Read it before you run it. It clones the repo, installs dependencies, starts a
# Postgres if it can, writes a local .env.local, creates the tables, and hands
# you a running app. It never asks for a password and never writes outside the
# directory it creates.
#
# Runs on macOS and Linux, and on Windows inside a WSL2 distro. Native Windows has
# its own installer, install.ps1. Needs git, Node 20 or newer, and either Docker or
# a Postgres it can reach. POSIX sh, no bashisms.

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

has() { command -v "$1" >/dev/null 2>&1; }

# macOS, Linux, or Linux running inside Windows (WSL2). A Windows shell that lands
# here by accident gets pointed at install.ps1.
case "$(uname -s 2>/dev/null || echo unknown)" in
  Darwin) PLATFORM=mac ;;
  Linux)
    if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
      PLATFORM=wsl
    else
      PLATFORM=linux
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM=windows ;;
  *) PLATFORM=other ;;
esac

# What to type to get Node here. Debian and Ubuntu still package a Node too old
# for Lore, so they get NodeSource rather than plain apt-get install nodejs.
node_hint() {
  if [ "$PLATFORM" = mac ]; then
    printf 'Install it from https://nodejs.org, or run: brew install node'
  elif has apt-get; then
    printf 'The nodejs package on Debian and Ubuntu is usually too old, so use NodeSource: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs'
  elif has dnf; then
    printf 'Run: sudo dnf install -y nodejs'
  elif has pacman; then
    printf 'Run: sudo pacman -S nodejs npm'
  elif has zypper; then
    printf 'Run: sudo zypper install -y nodejs22'
  elif has apk; then
    printf 'Run: sudo apk add nodejs npm'
  else
    printf 'Install Node %s or newer from https://nodejs.org, or with nvm from https://github.com/nvm-sh/nvm' "$MIN_NODE"
  fi
}

# What to type to get a Postgres here, when there is no Docker.
postgres_hint() {
  if [ "$PLATFORM" = mac ]; then
    printf 'brew install postgresql@16 && brew services start postgresql@16, or Postgres.app from https://postgresapp.com'
  elif has apt-get; then
    printf 'sudo apt-get install -y postgresql && sudo service postgresql start'
  elif has dnf; then
    printf 'sudo dnf install -y postgresql-server && sudo postgresql-setup --initdb && sudo systemctl enable --now postgresql'
  elif has pacman; then
    printf 'sudo pacman -S postgresql'
  elif has zypper; then
    printf 'sudo zypper install -y postgresql-server'
  elif has apk; then
    printf 'sudo apk add postgresql'
  else
    printf 'install Postgres 14 or newer from https://www.postgresql.org/download'
  fi
}

say "Installing Lore"

if [ "$PLATFORM" = windows ]; then
  die "This looks like Git Bash or MSYS. Windows has its own installer: open PowerShell and run

  irm https://raw.githubusercontent.com/veds260/lore/main/install.ps1 | iex

  WSL2 is the other way, if you would rather have a Linux shell: run wsl --install in an administrator PowerShell, restart, then run this same command inside Ubuntu."
fi

need git "Install it from https://git-scm.com"
need node "$(node_hint)"
need npm "It ships with Node. $(node_hint)"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  die "Node $MIN_NODE or newer is required. You have $(node -v). $(node_hint)"
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
  if has nc; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  elif has ss; then
    ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
  elif has lsof; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

# createdb ships with the Postgres client tools on most systems but not all of
# them, so fall back to plain SQL through psql.
make_db() {
  if has createdb; then
    createdb "$1" >>"$LOG" 2>&1
  else
    psql -d postgres -c "create database \"$1\"" >>"$LOG" 2>&1
  fi
}

DB_NAME="${LORE_DB_NAME:-lore}"

DOCKER=no
if has docker && docker info >/dev/null 2>&1; then
  DOCKER=yes
fi

if [ "$DOCKER" = yes ]; then
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
elif has psql; then
  if ! psql -d postgres -c 'select 1' >>"$LOG" 2>&1; then
    step "found psql, but could not reach a running postgres:"
    tail_log 4
    DB_WHY="psql is installed but no Postgres answered as $(id -un). Start the server, and on a fresh Linux install give yourself a role with sudo -u postgres createuser -s $(id -un). Docker is the other way: install it and run docker compose up -d in $DIR."
  elif psql -d "$DB_NAME" -c 'select 1' >/dev/null 2>&1 && [ "${LORE_REUSE_DB:-}" != yes ]; then
    DB_WHY="Your local Postgres already has a database called $DB_NAME, and Lore will not write into a database it did not create. Run the installer again with LORE_DB_NAME=some_new_name, or with LORE_REUSE_DB=yes if that database really is for Lore."
  else
    if [ "${LORE_REUSE_DB:-}" = yes ]; then
      step "using the existing $DB_NAME database on your local postgres, as LORE_REUSE_DB=yes asked"
    else
      step "creating a database called $DB_NAME on the postgres already running here"
      make_db "$DB_NAME" || { tail_log 4; }
    fi
    if psql -d "$DB_NAME" -c 'select 1' >>"$LOG" 2>&1; then
      LOCAL_URL="postgresql://$(id -un)@localhost:5432/$DB_NAME"
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
elif has docker; then
  DB_WHY="Docker is installed but its daemon did not answer. Start Docker Desktop, or on Linux run sudo systemctl start docker and add yourself to the docker group with sudo usermod -aG docker \"$(id -un)\", then log out and back in. A local Postgres works too: $(postgres_hint)"
else
  DB_WHY="No Postgres and no Docker on this computer. Either install Docker from https://docs.docker.com/get-docker and run docker compose up -d in $DIR, or install Postgres: $(postgres_hint)"
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

if [ "${LORE_RELAY:-}" = off ]; then
  # saying no once means no from now on, not just for this run
  if ! grep -q '^LORE_RELAY=' .env.local 2>/dev/null; then
    printf 'LORE_RELAY=off\n' >> .env.local
  fi
  step "the shared relay stays off, LORE_RELAY=off is in .env.local"
elif [ "$DB_READY" = yes ]; then
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
