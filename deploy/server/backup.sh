#!/usr/bin/env bash
# Tägliche Datenbanksicherung (murmel-backup.timer): pg_dump nach /var/backups/murmel, 14 Tage.
set -euo pipefail
DIR=/var/backups/murmel
mkdir -p "$DIR"
f="$DIR/murmel-$(date +%F-%H%M).sql.gz"
docker compose -f /opt/murmel/compose.yml --project-directory /opt/murmel exec -T db pg_dump -U murmel -d murmel --no-owner | gzip -9 > "$f.tmp"
# eine leere oder kaputte Sicherung nicht behalten
gzip -t "$f.tmp" && [ "$(zcat "$f.tmp" | head -c 100 | wc -c)" -gt 0 ]
mv "$f.tmp" "$f"
find "$DIR" -maxdepth 1 -name 'murmel-*.sql.gz' -mtime +14 -delete
echo "Sicherung: $f ($(du -h "$f" | cut -f1))"
