-- Murmel: Forum (docs/SERVER.md Abschnitt 7.1). Lesen ohne Konto, Schreiben nur mit Konto.
-- Reiner Text, keine Bilder. Löscht jemand sein Konto, gehen seine Beiträge, Stimmen und Meldungen mit
-- (on delete cascade); ein Thema verschwindet mit seinem ersten Beitrag samt Antworten.

-- Im Forum steht der Anzeigename, nie die Mailadresse. Eindeutig ohne Rücksicht auf Groß/Klein.
create unique index accounts_display_name on accounts (lower(display_name)) where display_name is not null;

create table forum_topics (
  id bigint generated always as identity primary key,
  account_id bigint not null references accounts on delete cascade,
  category text not null check (category in ('fehler', 'verbesserung', 'frage', 'level')),
  status text not null default 'offen' check (status in ('offen', 'geplant', 'erledigt')),
  title text not null check (char_length(title) between 3 and 120),
  -- „Fehler melden“ aus dem Spiel: Level-Kennung und Spielversion
  level text check (char_length(level) <= 120),
  version text check (char_length(version) <= 40),
  created_at timestamptz not null default now(),
  last_post_at timestamptz not null default now()
);
create index forum_topics_last on forum_topics (last_post_at desc);

create table forum_posts (
  id bigint generated always as identity primary key,
  topic_id bigint not null references forum_topics on delete cascade,
  account_id bigint not null references accounts on delete cascade,
  -- der erste Beitrag ist der Text des Themas; ausgeblendet = Thema ausgeblendet
  first boolean not null default false,
  body text not null check (char_length(body) between 1 and 5000),
  -- Autor war beim Schreiben Admin: Kennzeichen „Team“ (gegen Nachahmung)
  team boolean not null default false,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index forum_posts_topic on forum_posts (topic_id, id);
create index forum_posts_account on forum_posts (account_id, created_at);
create unique index forum_posts_first on forum_posts (topic_id) where first;

-- Daumen hoch: ein Konto, eine Stimme je Thema
create table forum_votes (
  topic_id bigint not null references forum_topics on delete cascade,
  account_id bigint not null references accounts on delete cascade,
  primary key (topic_id, account_id)
);

-- Meldungen: ein Konto meldet einen Beitrag einmal; ein Admin erledigt sie (ausblenden oder verwerfen)
create table forum_reports (
  post_id bigint not null references forum_posts on delete cascade,
  account_id bigint not null references accounts on delete cascade,
  reason text not null default '' check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (post_id, account_id)
);
