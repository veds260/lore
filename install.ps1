# Lore installer for Windows.
#
#   irm https://raw.githubusercontent.com/veds260/lore/main/install.ps1 | iex
#
# Read it before you run it. It clones the repo, installs dependencies, finds or
# starts a Postgres, writes a local .env.local, creates the tables and hands you a
# running app. It never writes outside the folder it creates, apart from the
# packages npm keeps in its own cache, and it asks before installing anything.
#
# Works in Windows PowerShell 5.1 and in PowerShell 7. Needs git and Node 20 or
# newer, and offers to install either with winget when it is missing. Nothing here
# needs an administrator except starting a Postgres service that is installed but
# stopped, and it says so when that happens.
#
# Knobs, all optional, all read from the environment so they work through `iex`:
#   LORE_DIR           where to install, default $env:USERPROFILE\lore
#   LORE_REPO          git URL to clone
#   LORE_BRANCH        branch to clone, default main
#   LORE_DB_NAME       database name, default lore
#   LORE_DB_URL        a Postgres you already have, used as it is
#   LORE_DB_PASSWORD   password for the postgres superuser, when one is installed
#   LORE_REUSE_DB=yes  write into an existing database of that name
#   LORE_RELAY=off     never contact the shared relay
#   LORE_YES=1         answer yes to every prompt, for unattended runs
#   LORE_NO_START=1    stop after setup instead of starting the app

param(
  [string]$Dir,
  [switch]$NoStart
)

# Every external command here is checked by its exit code, and the cmdlets that
# can fail are wrapped. A global Stop would instead turn anything a program prints
# on stderr into a crash, which npm and psql both do while working fine.
$ErrorActionPreference = 'Continue'
$MinNode = 20

function Say  ($m) { Write-Host ''; Write-Host "  $m" }
function Step ($m) { Write-Host "  $m" }
function Die  ($m) { Write-Host ''; Write-Host "  $m" -ForegroundColor Red; Write-Host ''; exit 1 }

function Have ($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Unattended { return [bool]($env:LORE_YES -or $env:CI) }

# A yes or no question. Unattended runs take the default without asking.
function Confirm ($question, [bool]$default = $true) {
  if (Unattended) { return $default }
  $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
  $answer = (Read-Host "  $question $hint").Trim()
  if ($answer -eq '') { return $default }
  return ($answer -match '^(y|yes)$')
}

# Runs a program, appends everything it printed to the log, returns its exit code.
function RunLogged ($exe, [string[]]$argList, $log) {
  & $exe @argList *>> $log
  return $LASTEXITCODE
}

function TailLog ($log, $lines = 12) {
  if (Test-Path $log) {
    Write-Host ''
    Get-Content $log -Tail $lines | ForEach-Object { Write-Host "    $_" }
    Write-Host ''
  }
}

# UTF-8 with no byte order mark, because a mark in .env.local would end up inside
# the name of the first setting.
function WriteText ($file, $text) {
  [System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# Sets or replaces one line in .env.local and leaves every other line alone.
function SetEnvLine ($file, $key, $value) {
  $lines = @()
  if (Test-Path $file) { $lines = [System.IO.File]::ReadAllText($file) -split "`r?`n" }
  $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -like "$key=*") { $lines[$i] = "$key=$value"; $done = $true }
  }
  if (-not $done) { $lines += "$key=$value" }
  WriteText $file (($lines -join "`n").TrimEnd() + "`n")
}

function HasEnvLine ($file, $key) {
  if (-not (Test-Path $file)) { return $false }
  return [bool](([System.IO.File]::ReadAllText($file) -split "`r?`n") | Where-Object { $_ -like "$key=*" })
}

# winget installs things without a download page and ships with Windows 11 and
# recent Windows 10. Without it we can only print the link. Returns a message when
# the caller still has a problem, or nothing when it worked.
function WingetOffer ($label, $package, $link) {
  if (-not (Have 'winget')) {
    return "$label is missing, and winget is not on this machine. Install it from $link and run this again."
  }
  if (-not (Confirm "$label is missing. Install it now with winget?")) {
    return "$label is missing. Install it with: winget install --id $package"
  }
  Step "installing $label, winget may ask for permission"
  # Out-Host, or everything winget prints becomes this function's return value.
  winget install --id $package --accept-source-agreements --accept-package-agreements --silent | Out-Host
  # A fresh install lands on the PATH of new processes, not this one, so read the
  # PATH back out of the registry instead of telling the person to start over.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  return $null
}

function PortBusy ($port) {
  $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($listening) { return $true }
  $probe = New-Object System.Net.Sockets.TcpClient
  try { $probe.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $probe.Dispose() }
}

Say 'Installing Lore'

# ---------------------------------------------------------------------------
# What has to be here before anything else
# ---------------------------------------------------------------------------

if (-not (Have 'git')) {
  $problem = WingetOffer 'git' 'Git.Git' 'https://git-scm.com/download/win'
  if ($problem) { Die $problem }
  if (-not (Have 'git')) { Die 'git installed, but it is not on this PATH yet. Open a new PowerShell window and run this again.' }
}

if (-not (Have 'node')) {
  $problem = WingetOffer 'Node.js' 'OpenJS.NodeJS.LTS' 'https://nodejs.org'
  if ($problem) { Die $problem }
  if (-not (Have 'node')) { Die 'Node installed, but it is not on this PATH yet. Close this window, open a new PowerShell, and run the installer again.' }
}

$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt $MinNode) {
  $problem = WingetOffer "Node $MinNode or newer, you have $(& node -v)" 'OpenJS.NodeJS.LTS' 'https://nodejs.org'
  if ($problem) { Die $problem }
  $nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
  if ($nodeMajor -lt $MinNode) { Die "Still on Node $(& node -v). Open a new PowerShell window so it picks up the new Node, then run this again." }
}

if (-not (Have 'npm')) { Die 'npm is missing. It ships with Node, so install Node again from https://nodejs.org' }

# ---------------------------------------------------------------------------
# Where it goes
# ---------------------------------------------------------------------------

$target = $Dir
if (-not $target) { $target = $env:LORE_DIR }
if (-not $target -and -not (Unattended)) {
  $default = Join-Path $env:USERPROFILE 'lore'
  $typed = (Read-Host "  Where should Lore live? [$default]").Trim()
  if ($typed) { $target = $typed }
}
if (-not $target) { $target = Join-Path $env:USERPROFILE 'lore' }
$target = [System.IO.Path]::GetFullPath($target)

if ((Test-Path $target) -and (Get-ChildItem -Force $target -ErrorAction SilentlyContinue)) {
  Die "$target already exists and is not empty. Pick another folder, or set LORE_DIR."
}

$repo   = if ($env:LORE_REPO) { $env:LORE_REPO } else { 'https://github.com/veds260/lore.git' }
$branch = if ($env:LORE_BRANCH) { $env:LORE_BRANCH } else { 'main' }

Step "cloning into $target"
git clone --depth 1 --branch $branch $repo $target *> $null
if ($LASTEXITCODE -ne 0) { Die "Could not clone $repo. If the repository is private, sign in to git first." }

Set-Location $target
$log = Join-Path $target '.install.log'
WriteText $log ''
$envFile = Join-Path $target '.env.local'

Step 'installing dependencies, this is the slow part'
if ((RunLogged 'npm' @('install', '--no-audit', '--no-fund') $log) -ne 0) {
  TailLog $log
  Die "npm install failed. Run it again inside $target to see the whole output."
}

Step 'writing .env.local and generating a signing secret'
RunLogged 'npx' @('--yes', 'tsx', 'scripts/predev.ts') $log | Out-Null

# ---------------------------------------------------------------------------
# The database
# ---------------------------------------------------------------------------

$dbName  = if ($env:LORE_DB_NAME) { $env:LORE_DB_NAME } else { 'lore' }
$dbReady = $false
$dbWhy   = ''
$pgHint  = 'Install Postgres with: winget install --id PostgreSQL.PostgreSQL.16 . Docker Desktop from https://docs.docker.com/desktop/install/windows-install works too, and then `docker compose up -d` in the Lore folder gives you one.'

if ($env:LORE_DB_URL) {
  Step 'using the database in LORE_DB_URL'
  SetEnvLine $envFile 'DATABASE_URL' $env:LORE_DB_URL
  $dbReady = $true
}

# Docker Desktop first, because it needs no password and no decisions.
if (-not $dbReady -and (Have 'docker')) {
  docker info *>> $log
  if ($LASTEXITCODE -eq 0) {
    if (PortBusy 5432) {
      $dbWhy = 'Port 5432 is already taken, most likely by a Postgres you already run, so the Docker database could not start. Stop that program and run `docker compose up -d`, or point DATABASE_URL in .env.local at an empty database on it.'
    } else {
      Step 'starting postgres in docker'
      if ((RunLogged 'docker' @('compose', 'up', '-d') $log) -eq 0) {
        for ($i = 0; $i -lt 40; $i++) {
          docker compose exec -T db pg_isready -U postgres -d lore *>> $log
          if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
          Start-Sleep -Seconds 1
        }
        if (-not $dbReady) { $dbWhy = 'The Docker database started but never answered. Run `docker compose logs db` to see why.' }
      } else {
        TailLog $log
        $dbWhy = 'docker compose up -d failed, see the lines above.'
      }
    }
  } else {
    $dbWhy = 'Docker is installed but its engine did not answer. Start Docker Desktop, wait for the whale in the tray to stop moving, then run this again.'
  }
}

# A Postgres installed by its own installer or by winget. It runs as a service and
# its superuser has a password, which is the one real difference from macOS and Linux.
if (-not $dbReady) {
  $service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue |
    Sort-Object @{ Expression = { $_.Status -eq 'Running' } } -Descending | Select-Object -First 1

  $psql = $null
  if ($env:PGBIN -and (Test-Path (Join-Path $env:PGBIN 'psql.exe'))) {
    $psql = Join-Path $env:PGBIN 'psql.exe'
  } elseif (Have 'psql') {
    $psql = (Get-Command psql).Source
  } else {
    $found = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $psql = $found.FullName }
  }

  if ($service -or $psql) {
    # A local Postgres beats whatever went wrong with Docker, so start over on the
    # reason rather than carrying the Docker one forward.
    $dbWhy = ''

    if ($service -and $service.Status -ne 'Running') {
      Step "starting the $($service.Name) service"
      try {
        Start-Service $service.Name -ErrorAction Stop
        $service.WaitForStatus('Running', (New-TimeSpan -Seconds 30))
      } catch {
        $dbWhy = "The $($service.Name) service is installed but stopped, and starting it needs an administrator. Open PowerShell as administrator, run: net start $($service.Name) , then run this installer again."
      }
    }

    if (-not $dbWhy -and -not $psql) {
      $dbWhy = 'A Postgres service is running but psql.exe is not on this machine. Install Postgres again with the command line tools ticked, or put its bin folder on PATH.'
    }

    if (-not $dbWhy) {
      $pgUser = if ($env:PGUSER) { $env:PGUSER } else { 'postgres' }
      $pgPass = if ($env:LORE_DB_PASSWORD) { $env:LORE_DB_PASSWORD } elseif ($env:PGPASSWORD) { $env:PGPASSWORD } else { '' }
      if (-not $pgPass -and -not (Unattended)) {
        Step "Postgres is installed here, and it wants the password you set for the $pgUser user when you installed it."
        $secure = Read-Host "  Password for $pgUser" -AsSecureString
        $pgPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
          [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
      }

      $env:PGPASSWORD = $pgPass
      $env:PGCLIENTENCODING = 'UTF8'
      & $psql -U $pgUser -h 127.0.0.1 -d postgres -c 'select 1' *>> $log

      if ($LASTEXITCODE -ne 0) {
        TailLog $log 6
        $dbWhy = "Postgres is installed but would not let $pgUser in. Check the password, or set LORE_DB_PASSWORD and run this again."
      } else {
        & $psql -U $pgUser -h 127.0.0.1 -d $dbName -c 'select 1' *> $null
        $exists = ($LASTEXITCODE -eq 0)

        if ($exists -and $env:LORE_REUSE_DB -ne 'yes') {
          $dbWhy = "Your Postgres already has a database called $dbName, and Lore will not write into a database it did not create. Run this again with LORE_DB_NAME set to a new name, or LORE_REUSE_DB=yes if that database really is for Lore."
        } else {
          if ($exists) {
            Step "using the existing $dbName database, as LORE_REUSE_DB=yes asked"
          } else {
            Step "creating a database called $dbName on the postgres already running here"
            & $psql -U $pgUser -h 127.0.0.1 -d postgres -c "create database ""$dbName""" *>> $log
          }
          & $psql -U $pgUser -h 127.0.0.1 -d $dbName -c 'select 1' *>> $log
          if ($LASTEXITCODE -eq 0) {
            $escaped = [uri]::EscapeDataString($pgPass)
            SetEnvLine $envFile 'DATABASE_URL' "postgresql://${pgUser}:${escaped}@127.0.0.1:5432/$dbName"
            $dbReady = $true
          } else {
            TailLog $log 6
            $dbWhy = "Could not open the $dbName database."
          }
        }
      }
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
  } elseif (-not $dbWhy) {
    $dbWhy = "No Postgres and no Docker on this computer. $pgHint"
  }
}

if ($dbReady) {
  Step 'creating the tables'
  if ((RunLogged 'npm' @('run', 'db:push') $log) -ne 0) {
    TailLog $log
    $dbReady = $false
    $dbWhy = 'npm run db:push failed, see the lines above.'
  }
}

# ---------------------------------------------------------------------------
# The shared relay, and then the app itself
# ---------------------------------------------------------------------------

if ($env:LORE_RELAY -eq 'off') {
  # saying no once means no from now on, not just for this run
  if (-not (HasEnvLine $envFile 'LORE_RELAY')) { SetEnvLine $envFile 'LORE_RELAY' 'off' }
  Step 'the shared relay stays off, LORE_RELAY=off is in .env.local'
} elseif ($dbReady) {
  Step 'connecting to the shared relay (set LORE_RELAY=off to skip this)'
  npm run --silent relay:connect
}

if (-not $dbReady) {
  Say 'Lore is installed, but it has no database yet.'
  Step $dbWhy
  Step "The full output is in $log"
  Step ''
  Step 'When the database is ready, finish setup:'
  Step ''
  Step "  cd $target"
  Step '  npm run setup'
  Step '  npm run dev'
  Write-Host ''
  exit 0
}

if ($NoStart -or $env:LORE_NO_START) {
  Say "Done. Lore is set up in $target, and this is how you start it:"
  Step '  npm run dev'
  Write-Host ''
  exit 0
}

Say 'Done. Starting Lore.'
Step 'Your browser opens so you can create your account. If it does not, use the link printed below.'
Write-Host ''
npm run dev
exit $LASTEXITCODE
