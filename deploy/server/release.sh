#!/usr/bin/env bash
# Murmel-Release auf dem VPS. Läuft als Benutzer murmel in /opt/murmel.
#   release.sh <version> <site-dir> <server-src-dir>   neues Release aktivieren
#   release.sh --rollback                              auf das vorherige Release zurück (hält
#                                                      den automatischen Rollout an: rm /opt/murmel/hold)
# <site-dir> ist das gebaute Spiel (dist/), <server-src-dir> der Ordner server/ des Repos.
set -euo pipefail

ROOT=/opt/murmel
RELEASES="$ROOT/www/releases"
KEEP=5
cd "$ROOT"

log() { echo "[release] $*"; }

# .env einmalig anlegen: Datenbankpasswort entsteht hier und verlässt den Server nie.
if [ ! -f .env ]; then
  umask 077
  printf 'POSTGRES_PASSWORD=%s\nSITE_ADDRESS=054heee.cserverhost.cloud\nMURMEL_VERSION=\n' "$(openssl rand -hex 24)" > .env
  log ".env angelegt"
fi

setenv() { # setenv KEY VALUE – ersetzt oder ergänzt eine Zeile in .env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
current_version() { grep '^MURMEL_VERSION=' .env | cut -d= -f2; }

activate() { # activate VERSION – Spiel umhängen, API-Image tauschen, prüfen
  local v="$1"
  [ -d "$RELEASES/$v" ] || { log "Release $v fehlt"; exit 1; }
  docker image inspect "murmel-api:$v" >/dev/null || { log "Image murmel-api:$v fehlt"; exit 1; }
  ln -sfn "releases/$v" "$ROOT/www/current.tmp" && mv -T "$ROOT/www/current.tmp" "$ROOT/www/current"
  setenv MURMEL_VERSION "$v"
  # Spielcode für die Bestenliste (siehe unten); notfalls leer, damit Docker ihn nicht als root anlegt
  mkdir -p "$ROOT/game/$v"
  # Apple-Schlüssel (compose.yml): ohne Datei /dev/null einhängen (Apple-Anmeldung aus), damit Docker
  # nicht als root ein leeres Verzeichnis apple-signin.p8 anlegt
  if [ -f "$ROOT/apple-signin.p8" ]; then unset APPLE_KEY_HOST; else export APPLE_KEY_HOST=/dev/null; log "apple-signin.p8 fehlt – Apple-Anmeldung aus"; fi
  docker compose up -d --remove-orphans
  # ein geändertes Caddyfile übernimmt Caddy nur nach einem Neuladen
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || log "Caddy-Neuladen gescheitert"
  for _ in $(seq 1 30); do
    if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q "\"version\":\"$v\""; then
      log "aktiv: $v"; return 0
    fi
    sleep 2
  done
  log "Gesundheitsprüfung für $v gescheitert"; return 1
}

if [ "${1:-}" = "--rollback" ]; then
  prev=$(cat "$ROOT/previous-version" 2>/dev/null || true)
  [ -n "$prev" ] || { log "kein vorheriges Release bekannt"; exit 1; }
  cur=$(current_version)
  activate "$prev"
  echo "$cur" > "$ROOT/previous-version"
  # automatischen Rollout anhalten, sonst käme nach 2 min wieder der neueste Stand
  date -Is > "$ROOT/hold"
  log "automatischer Rollout angehalten – fortsetzen mit: rm $ROOT/hold"
  exit 0
fi

v="$1"; site="$2"; src="$3"
[[ "$v" =~ ^[0-9a-f]{7,40}$ ]] || { log "ungültige Version: $v"; exit 1; }
cur=$(current_version)
if [ "$v" = "$cur" ]; then log "$v ist bereits aktiv"; exit 0; fi

# Spiel-Release anlegen
mkdir -p "$RELEASES"
rm -rf "$RELEASES/$v.tmp"
cp -a "$site" "$RELEASES/$v.tmp"
rm -rf "$RELEASES/$v"
mv "$RELEASES/$v.tmp" "$RELEASES/$v"

# API-Image bauen, Betriebsdateien übernehmen
docker build -q -t "murmel-api:$v" "$src" >/dev/null
# Spielcode dieser Version für die Bestenliste (docs/SPEC-bestenliste.md): die API spielt eingereichte
# Läufe damit nach, schreibgeschützt unter /game (compose.yml). Aus Git, nicht aus dem Arbeitsbaum.
repo="$src/.."
game="$ROOT/game/$v"
if [ ! -f "$game/tools/lib/check-worker.mjs" ] && git -C "$repo" cat-file -e "$v^{commit}" 2>/dev/null; then
  rm -rf "$game.tmp"
  mkdir -p "$game.tmp/node_modules"
  git -C "$repo" archive "$v" package.json src public/levels tools | tar -C "$game.tmp" -xf -
  # Lua für Node: fengari und seine Abhängigkeiten (wie loesbarkeit.sh)
  for m in fengari $(jq -r '.dependencies // {} | keys[]' "$repo/node_modules/fengari/package.json"); do
    cp -a "$repo/node_modules/$m" "$game.tmp/node_modules/"
  done
  rm -rf "$game"
  mv "$game.tmp" "$game"
fi
cp "$src/../deploy/server/compose.yml" "$src/../deploy/server/Caddyfile" "$src/../deploy/server/turnserver.conf" "$ROOT/"

if activate "$v"; then
  [ -n "$cur" ] && echo "$cur" > "$ROOT/previous-version"
else
  if [ -n "$cur" ]; then log "zurück auf $cur"; activate "$cur"; fi
  exit 1
fi

# Aufräumen: nur Unterordner von $RELEASES, die nach einer Version aussehen; aktives und vorheriges bleiben
prev=$(cat "$ROOT/previous-version" 2>/dev/null || true)
ls -1t "$RELEASES" | grep -E '^[0-9a-f]{7,40}$' | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$old" = "$v" ] || [ "$old" = "$prev" ] && continue
  rm -rf -- "${RELEASES:?}/$old"
  rm -rf -- "${ROOT:?}/game/$old"
  docker image rm "murmel-api:$old" >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null
