-- Herkunft (docs/SPEC-herkunft.md): von welchen Seiten und über welche Kampagnen-Links (?von=) Besucher
-- kamen. Nur Tageszähler je Domain und Kampagne, ohne IP, User-Agent, Pfad oder einzelne Besuche. Die API
-- normalisiert die Domain (Kleinbuchstaben, ohne "www.") und die Kampagne (Freigabeliste, sonst
-- "sonstige") und löscht Zeilen älter als 13 Monate beim ersten Eintrag eines neuen Tages.
-- Leere Zeichenkette = nicht vorhanden (Teil des Primärschlüssels, daher nicht null).
create table herkunft_tag (
  day date not null,
  domain text not null default '' check (domain = '' or (char_length(domain) between 3 and 253 and domain = lower(domain) and domain ~ '^[a-z0-9.-]+$')),
  von text not null default '' check (von ~ '^[a-z0-9-]{0,32}$'),
  anzahl integer not null check (anzahl > 0),
  primary key (day, domain, von),
  check (domain <> '' or von <> '')
);
