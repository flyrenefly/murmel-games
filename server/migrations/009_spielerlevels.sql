-- Murmel: Spieler-Levels (docs/SPEC-spielerlevels.md). Braucht accounts (003) und leaderboard (006).
-- 008 ist für Mehrspieler reserviert.

-- Ein hochgeladenes Level in einer Version. Gespeichert wird nur das geprüfte Level (sanitizeLevel im
-- Prüfprozess: nur Editor-Inhalte, nie Lua), nie das hochgeladene JSON. Löscht jemand sein Konto, gehen
-- seine Levels mit.
create table player_levels (
  id bigint generated always as identity primary key,
  account_id bigint not null references accounts on delete cascade,
  title text not null check (char_length(title) between 3 and 60),
  description text not null default '' check (char_length(description) <= 500),
  -- das geprüfte LevelFile ohne id und author (beides setzt die API beim Ausliefern)
  file jsonb not null,
  level_hash text not null,
  -- Lösung des Autors (nicht öffentlich): Nachweis, dass das Level lösbar ist
  recording jsonb not null,
  steps integer not null check (steps > 0),
  status text not null default 'wartet' check (status in ('wartet', 'frei', 'abgelehnt', 'zurueckgezogen', 'ersetzt')),
  -- Grund einer Ablehnung (sieht der Autor)
  reason text check (char_length(reason) <= 300),
  -- neue Version eines eigenen Levels: die Freigabe setzt das alte auf 'ersetzt'
  replaces bigint references player_levels on delete set null,
  created_at timestamptz not null default now(),
  -- erste Freigabe (Sortierung „neu“)
  published_at timestamptz,
  reviewed_at timestamptz,
  -- Admin-Mail verschickt (gebündelt, höchstens einmal je Stunde)
  notified_at timestamptz
);
create index player_levels_public on player_levels (published_at desc) where status = 'frei';
create index player_levels_account on player_levels (account_id, created_at);
create index player_levels_waiting on player_levels (created_at) where status = 'wartet';

-- Bewertung 1–5: ein Konto, eine Stimme je Level (nur wer es gelöst hat; prüft die API)
create table player_level_ratings (
  level_id bigint not null references player_levels on delete cascade,
  account_id bigint not null references accounts on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (level_id, account_id)
);

-- Meldungen: eine offene Meldung blendet das Level aus, bis ein Admin entscheidet (dismissed_at)
create table player_level_reports (
  level_id bigint not null references player_levels on delete cascade,
  account_id bigint not null references accounts on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (level_id, account_id)
);
create index player_level_reports_open on player_level_reports (level_id) where dismissed_at is null;

-- Zeitpunkt der letzten Admin-Mail (eine Zeile): höchstens eine Mail je Stunde, auch nach Neustarts
-- und wenn die erwähnten Levels inzwischen gelöscht sind
create table player_level_mail (
  only_row boolean primary key default true check (only_row),
  sent_at timestamptz not null
);

-- Bestenlisten-Einträge eines Spieler-Levels (Kennung 'spieler:<id>') gehen mit dem Level – auch wenn es
-- mit dem Konto des Autors gelöscht wird.
create function player_levels_drop_leaderboard() returns trigger language plpgsql as $$
begin
  delete from leaderboard where level = 'spieler:' || old.id;
  return old;
end;
$$;
create trigger player_levels_leaderboard after delete on player_levels
  for each row execute function player_levels_drop_leaderboard();
