-- Murmel: Erinnerung an das Tageslevel per Web Push (docs/SPEC-webpush.md).
-- Nur, was der Versand braucht: keine IP, kein Konto.
create table push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 1 and 1024),
  p256dh text not null check (char_length(p256dh) between 80 and 100),
  auth text not null check (char_length(auth) between 16 and 30),
  tag boolean not null,
  woche boolean not null,
  created_at timestamptz not null default now(),
  check (tag or woche)
);

-- Schon verschickte Zeiträume: ein Neustart der API schickt nicht doppelt.
create table push_sent (
  art text not null check (art in ('tag', 'woche')),
  zeitraum text not null check (char_length(zeitraum) between 1 and 20),
  sent_at timestamptz not null default now(),
  primary key (art, zeitraum)
);
