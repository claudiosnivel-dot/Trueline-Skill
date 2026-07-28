# Dogfood — osservazioni dal progetto reale

> **Cos'è questo file.** Il backlog di Trueline lo detta il **dogfood**, non la roadmap
> (`PROMPT — Adozione Opus 5` §8). Qui si annotano, **sul momento**, i segnali che emergono
> usando Trueline su un progetto reale. Il pattern ha già funzionato: **A0** è nato da una
> domanda reale sugli oracoli di qualità; **A2a** è stata **tarata sulla misura di un repo
> vero** (`ASV Officina`) *prima* di scrivere codice.
>
> **Regola d'oro (`L-COL-006`):** prima di costruire qualunque cosa da questa lista,
> **misurare sul progetto reale** (come per A2a). Poi decidere. Un'osservazione qui è un
> *segnale da misurare*, non un task approvato.
>
> **Roadmap di ampiezza CONGELATA** (§7): niente nuovi pack/feature per inseguire un segnale;
> i flake si risolvono in seriale, non con un retry.

---

## Come annotare

Aggiungi una riga nella tabella pertinente, **appena** il segnale emerge (non a posteriori).
Campi: **data** (assoluta), **progetto/pack**, **modalità** (BUILD/REMEDIATE), **cosa è
successo** (concreto, con file/finding), **misura necessaria** prima di agire.

Il segnale **più informativo** è l'ultimo — *ogni volta che Trueline viene bypassata* — ed è
quello che si perde se non lo si annota sul momento.

---

## 1. Falsi verdi (un difetto reale è passato come verde)

Il più grave: intacca `L-COL-002`/`L-COL-006`. Traccia sempre all'oracolo/gate che ha
prodotto il verde.

| Data | Progetto/pack | Modalità | Cosa è passato (e da quale gate) | Misura necessaria |
|---|---|---|---|---|
| _(nessuna ancora)_ | | | | |

## 2. Falsi rossi (verde-in-realtà segnalato rosso)

Spesso **infrastruttura/concorrenza**, non merito (storico: SP-1 T2.0/T3.1, SP-3 T3.1,
SP-4 m5 55/56, SP-5 osv killato). Si risolve in **seriale** + pattern per-pid, **non** con
un retry.

| Data | Progetto/pack | Modalità | Rosso spurio (e causa: infra? concorrenza temp? tool assente?) | Misura necessaria |
|---|---|---|---|---|
| _(nessuna ancora)_ | | | | |

## 3. Finding rumorosi (veri ma a basso segnale / FP sospetti)

Ruolo LLM ristretto (`L-COL-028`): segnala-con-evidenza + abbassa priorità; **mai** sopprime.

| Data | Progetto/pack | Modalità | Finding (categoria/oracolo) e perché rumoroso | Misura necessaria |
|---|---|---|---|---|
| 2026-07-28 | progetto-web-ai / supabase-jsts | REMEDIATE (scan a sola lettura) | **28 finding su 30 vengono da .next/** — output di build di Next.js, **gitignorato**: manifest, chunk e source-map generati (regole jwt, generic-api-key, trueline-generic-assigned-secret). I 2 finding restanti sono in .env.local (anch esso gitignorato). Il segnale vero verrebbe **soffocato** dal rumore, ed e il primo checkpoint di un progetto in costruzione a pagarlo. | Decidere il confine dello **scope di scansione** del working-tree: gitleaks non rispetta .gitignore. Misurare quanti finding restano escludendo gli artefatti di build (.next/, dist/, build/, coverage/) su 2-3 progetti reali, e se l esclusione debba essere **dichiarata nel manifest del pack** (come oracles.rls.scan) invece che cablata. Attenzione: escludere per gitignore e **troppo largo** — un .env gitignorato con credenziali vere resta un finding che si vuole vedere. |

## 4. Bypass (Trueline è stata aggirata) — il segnale più informativo

Ogni volta che qualcuno salta il gate, disabilita un oracolo, mergia senza il verde, o non
usa affatto la skill dove avrebbe dovuto. Annota **perché** è stata bypassata.

| Data | Progetto/pack | Contesto del bypass | Perché è stata aggirata (attrito? falso rosso? lentezza? mancava un pack?) | Misura necessaria |
|---|---|---|---|---|
| _(nessuna ancora)_ | | | | |
