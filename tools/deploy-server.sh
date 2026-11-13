#!/usr/bin/env bash
# Rollout auf den Murmel-VPS vom Entwicklungsrechner (Git Bash).
#   tools/deploy-server.sh             aktuellen Commit bauen und ausrollen
#   tools/deploy-server.sh --rollback  vorheriges Release aktivieren
# Normalweg ist der automatische Rollout auf dem Server (murmel-update.timer); dieses Skript
# ist für den ersten Rollout und für Notfälle.
set -euo pipefail
HOST=${MURMEL_HOST:-murmel@85.215.139.111}
KEY=${MURMEL_KEY:-$HOME/.ssh/murmel_vps_ed25519}
SSH=(ssh -i "$KEY" -o BatchMode=yes "$HOST")
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--rollback" ]; then "${SSH[@]}" /opt/murmel/release.sh --rollback; exit; fi

[ -z "$(git status --porcelain)" ] || { echo "Arbeitsbaum nicht sauber – erst committen"; exit 1; }
v=$(git rev-parse --short=12 HEAD)
npm run build >/dev/null
"${SSH[@]}" "mkdir -p /opt/murmel/incoming/$v && cd /opt/murmel/incoming/$v && rm -rf site repo && mkdir -p site repo"
tar -C dist -cf - . | "${SSH[@]}" "tar -C /opt/murmel/incoming/$v/site -xf -"
git archive HEAD server deploy/server | "${SSH[@]}" "tar -C /opt/murmel/incoming/$v/repo -xf -"
"${SSH[@]}" "install -m 755 /opt/murmel/incoming/$v/repo/deploy/server/release.sh /opt/murmel/incoming/$v/repo/deploy/server/backup.sh /opt/murmel/ \
  && /opt/murmel/release.sh $v /opt/murmel/incoming/$v/site /opt/murmel/incoming/$v/repo/server \
  && rm -rf /opt/murmel/incoming/$v"
