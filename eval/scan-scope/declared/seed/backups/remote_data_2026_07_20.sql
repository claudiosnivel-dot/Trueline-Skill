-- FIXTURE `declared` — DUMP DI DATI (classe C del PLAN §1: 121 dei 192 finding misurati,
-- in crescita di ~5 al giorno perche' i dump si accumulano).
--
-- E' gitignorato, sta in una cartella che nessun ecosistema puo' conoscere a priori
-- (`backups/`), e non e' codice d'autore. Il PLAN lo chiude con la LEVA 3 — la
-- dichiarazione DI PROGETTO `.trueline/scan-scope.json` — non spegnendo la regola
-- `generic-api-key` (PLAN §5: sopprimerla globalmente sarebbe il falso verde che questo
-- prodotto esiste per evitare).
--
-- Bersaglio del sotto-test (7) `project-scope:applied` (pattern `backups/**`, provenienza
-- `project`) e del sotto-test (8) `project-scope:reason-required` (la stessa esclusione,
-- privata del `reason`, deve essere RIFIUTATA a voce alta, non ignorata in silenzio).
--
-- Tutti i valori sono SINTETICI.

COPY public.utenti (id, email, ruolo, password_hash) FROM stdin;
7f3a1c8e-4b21-4d9a-9f10-2c5e8a7b1d34	mario.rossi@example.test	admin	$2a$10$K9fQw2Zx7Lm4Bd1Tn6Ps3u
9c1b7d2f-8a44-4e13-b7c0-6d3f9e2a5b81	lucia.bianchi@example.test	operatore	$2a$10$T4vN8cRy1Hp5Xm2Bd6Qwa
\.

INSERT INTO public.integrazioni (id, nome, config) VALUES
  ('2e9d4a6b-1f37-4c82-a5b9-0d7e3f6c8a12', 'smtp', '{"host":"smtp.example.test","smtp_password":"Kf9Qw2Zx7Lm4Bd1Tn6Ps3Wc5Yh0Ju8Rg"}'),
  ('5b8c2f1a-7d64-49e0-b3a7-8c1d5e9f2b46', 'webhook', '{"endpoint":"https://hooks.example.test/x","signing_secret":"Rt6Yh2Ku8Nm3Qp7Vb1Zx4Wc9Sd0Fg5J"}');
