#!/usr/bin/env bash
# Nachtlauf der Lösbarkeitsprüfung (murmel-loesbarkeit.timer, docs/SPEC-loesbarkeit.md): startet jedes
# Level der aktiven Version ohne Grafik, spielt alle Lösungen (Repo und Datenbank) nach, speichert das
# Ergebnis in der Datenbank und schreibt den Admins nur bei neuen Fehlschlägen.
# Läuft als Benutzer murmel; die Rechnung im Container mit einem Kern und niedrigster Priorität.
set -euo pipefail
ROOT=/opt/murmel
WORK="$ROOT/loesbarkeit"
cd "$ROOT"
exec 8>"$ROOT/loesbarkeit.lock"
flock -n 8 || { echo "[loesbarkeit] läuft schon"; exit 0; }

v=$(grep '^MURMEL_VERSION=' .env | cut -d= -f2)
[[ "$v" =~ ^[0-9a-f]{7,40}$ ]] || { echo "[loesbarkeit] keine aktive Version"; exit 1; }

# Code der aktiven Version aus Git (nicht der Arbeitsbaum, den der Rollout gerade ändern könnte)
rm -rf "$WORK"
mkdir -p "$WORK/node_modules"
trap 'rm -rf "$WORK"' EXIT
paths=()
for p in package.json src public/levels solutions tools; do
  git -C "$ROOT/repo" cat-file -e "$v:$p" 2>/dev/null && paths+=("$p")
done
git -C "$ROOT/repo" archive "$v" "${paths[@]}" | tar -C "$WORK" -xf -
# Lua für Node: fengari und seine Abhängigkeiten aus dem gebauten Repo
for m in fengari $(jq -r '.dependencies // {} | keys[]' "$ROOT/repo/node_modules/fengari/package.json"); do
  cp -a "$ROOT/repo/node_modules/$m" "$WORK/node_modules/"
done

LOESBARKEIT_DIR="$WORK" docker compose --profile nacht run --rm -T loesbarkeit
