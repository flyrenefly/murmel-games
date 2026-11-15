-- Spieler-Levels aus Enigma-Dateien (docs/SPEC-enigma-upload.md): optionale Herkunftsangabe, angezeigt als
-- „nach einem Enigma-Level von …“. Vorbelegt aus Autor und Lizenz der Datei, vom Hochladenden änderbar.
-- Bestehende Levels bleiben ohne Angabe (null).
alter table player_levels add column based_on text check (char_length(based_on) between 1 and 80);
