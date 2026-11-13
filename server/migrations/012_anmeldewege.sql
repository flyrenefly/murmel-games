-- Murmel: Konten Stufe 2 (docs/SPEC-konten.md): Anmeldung mit Google, Apple, GitHub.
-- Je Anmeldeweg die zuletzt bestätigte Mailadresse, damit die Kontoseite zeigen kann, welches
-- Google-, Apple- oder GitHub-Konto verbunden ist. Keine Tokens der Anbieter.
alter table account_identities add column email citext;
update account_identities set email = subject where provider = 'mail';
