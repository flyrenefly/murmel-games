-- Anonyme Tagesstatistik (Baustein statistik): wie viele Spieler pro Tag, Levelstarts, gelöste Levels.
-- Kein Cookie, keine IP-Adresse: Ein Spieler ist ein Prüfwert aus IP, Browserkennung und einem
-- Tagesschlüssel. Schlüssel und Prüfwerte älterer Tage werden gelöscht, übrig bleiben nur Zahlen.
create table stat_salt (
  day date primary key,
  salt bytea not null
);

create table stat_player (
  day date not null,
  player bytea not null,
  primary key (day, player)
);

create table stat_day (
  day date primary key,
  players integer not null default 0,
  starts integer not null default 0,
  solved integer not null default 0
);

create table stat_level (
  day date not null,
  level text not null,
  starts integer not null default 0,
  solved integer not null default 0,
  primary key (day, level)
);
