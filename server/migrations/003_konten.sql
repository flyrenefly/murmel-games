-- Murmel: Konten (docs/SERVER.md Abschnitt 4). Keine Passwörter: Anmeldung per Mail-Link oder Passkey,
-- später Google/Apple/GitHub über account_identities. Geheime Werte (Links, Sitzungen) nur als SHA-256.
-- Unabhängig von 002 (Statistik), damit beide Branches in beliebiger Reihenfolge ankommen können.
create extension if not exists citext;

create table accounts (
  id bigint generated always as identity primary key,
  email citext not null unique,
  display_name text check (char_length(display_name) <= 40),
  -- 'admin' wird bei jeder Anmeldung aus ADMIN_EMAILS (/opt/murmel/.env) gesetzt oder entzogen
  role text not null default 'player' check (role in ('player', 'admin')),
  created_at timestamptz not null default now()
);

-- Anmeldewege je Konto: 'mail' (subject = Adresse), später 'google', 'apple', 'github' (subject = sub/id)
create table account_identities (
  provider text not null check (provider in ('mail', 'google', 'apple', 'github')),
  subject text not null,
  account_id bigint not null references accounts on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index account_identities_account on account_identities (account_id);

-- Login-Links: 15 Minuten gültig, nur einmal einlösbar
create table login_tokens (
  token_hash bytea primary key,
  email citext not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index login_tokens_email on login_tokens (email, created_at);

create table sessions (
  token_hash bytea primary key,
  account_id bigint not null references accounts on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_account on sessions (account_id);

create table passkeys (
  id text primary key, -- Credential-ID (base64url)
  account_id bigint not null references accounts on delete cascade,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_account on passkeys (account_id);

-- WebAuthn-Challenges: wenige Minuten gültig, werden beim Einlösen gelöscht
create table webauthn_challenges (
  id_hash bytea primary key,
  purpose text not null check (purpose in ('register', 'login')),
  challenge text not null,
  account_id bigint references accounts on delete cascade,
  expires_at timestamptz not null
);
