#!/usr/bin/env bash
# Automatischer Rollout (murmel-update.timer, alle 2 min): Steht auf main ein neuer Commit, dessen
# CI-Lauf „build“ grün ist, wird er auf dem Server gebaut und mit release.sh aktiviert.
# Der Server holt selbst (öffentliches Repo) – GitHub braucht keinen Zugang zum Server.
set -euo pipefail
REPO=https://github.com/flyrenefly/murmel-games.git
API=https://api.github.com/repos/flyrenefly/murmel-games
ROOT=/opt/murmel
WORK="$ROOT/repo"
exec 9>"$ROOT/update.lock"
flock -n 9 || exit 0
# nach einem Rückweg (release.sh --rollback) angehalten, bis /opt/murmel/hold entfernt wird
[ -e "$ROOT/hold" ] && exit 0

log() { echo "[update] $*"; }

sha=$(git ls-remote "$REPO" refs/heads/main | cut -f1)
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { log "main nicht lesbar"; exit 1; }
v=${sha:0:12}
cur=$(grep '^MURMEL_VERSION=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 || true)
[ "$v" = "$cur" ] && exit 0
[ "$v" = "$(cat "$ROOT/failed-version" 2>/dev/null || true)" ] && exit 0

# nur Commits mit grünem CI-Lauf „build“
ci=$(curl -fsS "$API/commits/$sha/check-runs?check_name=build" | jq -r '[.check_runs[] | select(.status=="completed")] | first | .conclusion // "pending"')
if [ "$ci" != "success" ]; then
  [ "$ci" = "pending" ] || { log "$v: CI $ci – wird nicht ausgerollt"; echo "$v" > "$ROOT/failed-version"; }
  exit 0
fi

log "baue $v"
[ -d "$WORK/.git" ] || git clone -q "$REPO" "$WORK"
git -C "$WORK" fetch -q origin main
git -C "$WORK" checkout -q --detach "$sha"
git -C "$WORK" clean -qfdx -e node_modules
# Spiel bauen wie in der CI, im Node-Container als Benutzer murmel (uid 1000)
docker run --rm --user 1000:1000 -e npm_config_cache=/tmp/npm -v "$WORK":/src -w /src node:24-alpine \
  sh -c 'npm ci --no-audit --no-fund >/dev/null && npx vite build >/dev/null'

install -m 755 "$WORK/deploy/server/release.sh" "$WORK/deploy/server/backup.sh" "$WORK/deploy/server/update.sh" "$ROOT/"
if "$ROOT/release.sh" "$v" "$WORK/dist" "$WORK/server"; then
  rm -f "$ROOT/failed-version"
else
  echo "$v" > "$ROOT/failed-version"
  log "$v fehlgeschlagen, vorheriges Release bleibt aktiv"
  exit 1
fi
