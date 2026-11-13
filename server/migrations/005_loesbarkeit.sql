-- Murmel: Lösbarkeitsprüfung (docs/SPEC-loesbarkeit.md). Unabhängig von 004 (Forum), braucht nur
-- accounts aus 003.

-- Lösungen, die Admins nach einem Sieg speichern (Weg (a)); die Repo-Lösungen liegen unter solutions/.
create table solutions (
  id bigint generated always as identity primary key,
  level text not null check (char_length(level) between 1 and 200),
  -- SHA-256 der Aufzeichnung: dieselbe Lösung nur einmal je Level
  recording_hash bytea not null,
  -- SHA-256 des Levelinhalts; setzt der erste Nachtlauf, danach meldet er „Level geändert“
  level_hash text,
  recording jsonb not null,
  steps integer not null check (steps > 0),
  account_id bigint references accounts on delete set null,
  created_at timestamptz not null default now(),
  unique (level, recording_hash)
);

-- Ein Nachtlauf: Stand (Commit) und Zahlen; Läufe älter als 90 Tage löscht der Nachtlauf selbst.
create table solvability_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  version text not null,
  levels integer not null default 0,
  probe_ok integer not null default 0,
  probe_lua integer not null default 0,
  probe_failed integer not null default 0,
  solutions integer not null default 0,
  solved integer not null default 0,
  unsolved integer not null default 0,
  failed integer not null default 0,
  -- Levels mit mindestens einer gewinnenden Lösung
  solved_levels integer not null default 0,
  new_failures integer not null default 0,
  -- der Lauf selbst ist gescheitert (Werkzeug nicht startbar o. Ä.)
  error text
);

-- Ergebnis je Level und Prüfung: Ladeprobe (ref '') oder Lösung (ref 'repo:<datei>' / 'db:<id>').
create table solvability_results (
  run_id bigint not null references solvability_runs on delete cascade,
  level text not null,
  kind text not null check (kind in ('probe', 'solution')),
  ref text not null default '',
  status text not null check (status in ('ok', 'lua', 'fehler', 'geloest', 'nicht-geloest')),
  steps integer,
  recorded_steps integer,
  level_changed boolean not null default false,
  is_new boolean not null default false,
  error text,
  primary key (run_id, kind, level, ref)
);
create index solvability_results_level on solvability_results (level, run_id);
