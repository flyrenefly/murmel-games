-- Auswertung (docs/SPEC-auswertung.md): wo Spieler scheitern oder abbrechen. Nur Tageszähler je Paket und
-- Level, ohne IP, Prüfwert, Konto oder einzelne Läufe. Zeilen älter als 365 Tage löscht die API beim ersten
-- Eintrag eines neuen Tages. Zeitklassen: unter 1, 1–3, 3–10, 10–30, ab 30 Minuten Spielzeit.
create table auswertung_level (
  day date not null,
  pack text not null check (char_length(pack) between 1 and 100),
  level text not null check (char_length(level) between 1 and 100),
  gestartet integer not null default 0,
  geloest integer not null default 0,
  neustart integer not null default 0,
  abbruch integer not null default 0,
  abstuerze integer not null default 0,
  zeit_geloest integer[] not null default '{0,0,0,0,0}' check (cardinality(zeit_geloest) = 5),
  zeit_abbruch integer[] not null default '{0,0,0,0,0}' check (cardinality(zeit_abbruch) = 5),
  primary key (day, pack, level)
);
