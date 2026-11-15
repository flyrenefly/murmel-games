-- Auswertung (docs/SPEC-auswertung.md): wie oft der Weg aus den Tipps (docs/SPEC-tipps.md) gezeigt wurde,
-- als weiterer Tageszähler je Paket und Level. Ältere Zeilen und Bündel ohne den Wert zählen 0.
alter table auswertung_level add column weg_gezeigt integer not null default 0;
