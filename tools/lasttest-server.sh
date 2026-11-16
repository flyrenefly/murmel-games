#!/bin/sh
# Begleitet tools/lasttest.mjs: schreibt auf dem Server alle ~5 s Last, CPU, RAM, Container-Werte und
# DB-Verbindungen mit (nur lesend). Aufruf von hier aus, Ausgabe lokal:
#   ssh -i ~/.ssh/murmel_vps_ed25519 murmel@85.215.139.111 'sh -s 90' < tools/lasttest-server.sh > server.log
# Argument: Zahl der Durchläufe (90 ≈ 8–10 min).
n=${1:-90}
i=0
while [ "$i" -lt "$n" ]; do
  echo "=== $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
  # CPU über 1 s: us sy id wa st
  vmstat 1 2 | tail -1 | awk '{print "cpu us=" $13 " sy=" $14 " id=" $15 " wa=" $16 " st=" $17}'
  free -m | awk '/Mem:/ {print "mem used=" $3 "M avail=" $7 "M"}'
  sudo docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} net={{.NetIO}}'
  sudo docker exec murmel-db-1 psql -U murmel -d murmel -tAc \
    "select 'db conn=' || count(*) || ' active=' || count(*) filter (where state='active') from pg_stat_activity where datname='murmel'"
  i=$((i + 1))
  sleep 2
done
