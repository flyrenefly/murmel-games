-- Murmel: Geister (docs/SPEC-geister.md). Wer hier steht, zeigt seine Bestenlisten-Läufe anderen als
-- Geist (Nutzerentscheidung 13.11.2026: nur mit eigener Freigabe, Standard aus). Ausschalten löscht die
-- Zeile; ein gelöschtes Konto nimmt sie mit (on delete cascade). Aufzeichnungen liegen weiter nur in
-- leaderboard (Migration 006).
create table ghost_consent (
  account_id bigint primary key references accounts on delete cascade,
  created_at timestamptz not null default now()
);
