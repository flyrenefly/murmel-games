-- Murmel: Fortschritt auf allen Geräten (docs/SPEC-sync.md). Je Konto ein Datensatz mit dem
-- UNGEPRÜFTEN Fortschritt aus dem Browser (Format von src/game/progress.ts). Nur für das eigene Konto
-- lesbar; erscheint nie in einer Rangliste (geprüfte Zeiten: Baustein bestenliste, Migration 006).
-- Löscht jemand sein Konto, geht der Fortschritt mit (on delete cascade).
create table progress_sync (
  account_id bigint primary key references accounts on delete cascade,
  -- optimistisches Sperren: Schreiben nur, wenn der Browser die aktuelle Version kennt
  version integer not null check (version > 0),
  data jsonb not null check (octet_length(data::text) <= 1048576),
  updated_at timestamptz not null default now()
);
