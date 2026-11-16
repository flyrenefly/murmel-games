-- Herkunft (docs/SPEC-herkunft.md): von welchen Seiten Besucher kamen. Nur Tageszähler je Domain, ohne
-- IP, User-Agent, Pfad oder einzelne Besuche. Die API normalisiert die Domain (Kleinbuchstaben, ohne
-- "www.") und löscht Zeilen älter als 13 Monate beim ersten Eintrag eines neuen Tages.
create table herkunft_tag (
  day date not null,
  domain text not null check (char_length(domain) between 3 and 253 and domain = lower(domain) and domain ~ '^[a-z0-9.-]+$'),
  anzahl integer not null check (anzahl > 0),
  primary key (day, domain)
);
