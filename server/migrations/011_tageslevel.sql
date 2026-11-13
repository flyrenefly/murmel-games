-- Murmel: Tageslevel und Wochenaufgabe (docs/SPEC-tageslevel.md). Braucht accounts aus 003.

-- Die Wahl je Zeitraum: einmal getroffen, bleibt sie (auch wenn sich der Pool ändert).
create table daily_tasks (
  art text not null check (art in ('tag', 'woche')),
  -- '2026-11-13' (Berliner Tag) oder '2026-W46' (ISO-Woche in Berlin)
  zeitraum text not null check (char_length(zeitraum) between 1 and 20),
  level text not null check (char_length(level) between 1 and 200),
  pack text not null,
  index integer not null check (index >= 0),
  titel text not null,
  seed bigint not null check (seed >= 0 and seed < 4294967296),
  created_at timestamptz not null default now(),
  primary key (art, zeitraum)
);

-- Ein Eintrag je Konto und Aufgabe: nur der beste nachgespielte Lauf (Aufzeichnung nicht öffentlich).
create table daily_runs (
  id bigint generated always as identity primary key,
  art text not null,
  zeitraum text not null,
  account_id bigint not null references accounts on delete cascade,
  steps integer not null check (steps > 0),
  recording jsonb not null,
  created_at timestamptz not null default now(),
  unique (art, zeitraum, account_id),
  foreign key (art, zeitraum) references daily_tasks on delete cascade
);
create index daily_runs_rank on daily_runs (art, zeitraum, steps, created_at, id);
