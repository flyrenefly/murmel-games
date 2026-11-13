-- Murmel: Bestenlisten (docs/SPEC-bestenliste.md). Braucht accounts aus 003.

-- Ein Eintrag je Konto und Level: nur der beste geprüfte Lauf. Die Zeit (steps) ist die beim
-- Nachspielen auf dem Server gemessene, nie die vom Browser gemeldete.
create table leaderboard (
  id bigint generated always as identity primary key,
  account_id bigint not null references accounts on delete cascade,
  level text not null check (char_length(level) between 1 and 200),
  steps integer not null check (steps > 0),
  -- SHA-256 des Levelinhalts, mit dem geprüft wurde, und die Version des Servers
  level_hash text not null,
  version text not null,
  -- Aufzeichnung des besten Laufs (nicht öffentlich); geht mit dem Eintrag
  recording jsonb not null,
  -- Zeitpunkt des Laufs, der den Eintrag gesetzt hat: entscheidet bei gleicher Zeit
  created_at timestamptz not null default now(),
  unique (account_id, level)
);
create index leaderboard_rank on leaderboard (level, steps, created_at, id);
