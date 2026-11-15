-- Murmel: Spielstand mitten im Level in der Cloud (docs/SPEC-cloudstand.md). Je Konto und Level
-- höchstens ein Stand: Startwert plus Eingabeaufzeichnung bis zum Speicherpunkt (gzip, Base64), dazu ein
-- Prüfcode des Zustands. Nur für das eigene Konto lesbar, nie in einer Rangliste. Löscht jemand sein
-- Konto, gehen die Stände mit (on delete cascade); nach 90 Tagen ohne Sichern räumt der Server auf.
create table cloud_saves (
  account_id bigint not null references accounts on delete cascade,
  level text not null check (char_length(level) between 1 and 200),
  pack text not null check (char_length(pack) between 1 and 100),
  seed bigint not null check (seed between 0 and 4294967295),
  leben integer check (leben between 0 and 99),
  steps integer not null check (steps between 1 and 1440000),
  version text not null check (char_length(version) between 1 and 64),
  pruef text not null check (char_length(pruef) between 1 and 200),
  daten text not null check (char_length(daten) between 1 and 2000000),
  updated_at timestamptz not null default now(),
  primary key (account_id, level)
);
create index cloud_saves_updated on cloud_saves (updated_at);
