-- Admin-Statistik der Konten: Anmeldungen je Tag (Berliner Tag). Wer sich angemeldet hat, steht nur für den
-- laufenden Tag in signin_seen (um Konten je Tag nur einmal zu zählen) und wird mit dem ersten Login des
-- nächsten Tages gelöscht; übrig bleiben nur Tageszahlen. Neue Konten je Tag kommen aus accounts.created_at.
create table signin_day (
  day date primary key,
  sign_ins integer not null default 0,
  accounts integer not null default 0
);

create table signin_seen (
  day date not null,
  account_id bigint not null references accounts on delete cascade,
  primary key (day, account_id)
);
