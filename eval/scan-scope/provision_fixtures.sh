#!/usr/bin/env bash
# provision_fixtures.sh — MATERIALIZZA le fixture del keystone `scan_scope_check`
# (passo d'ORCHESTRATORE).
#
# Gli agenti del Dynamic Workflow NON toccano git (L-COL-024): la creazione dell'inner-repo
# delle fixture e' quindi un passo dell'orchestratore, eseguito DOPO che il workflow ha
# costruito i sorgenti. Mirror di eval/anti-tamper/provision_fixtures.sh e
# eval/build-discipline/provision_fixtures.sh, con UNA differenza che vale la pena
# spiegare per intero.
#
# PERCHE' `seed/` -> `project/` E NON UN ALBERO GIA' PRONTO
# --------------------------------------------------------
# Questa fixture ha bisogno, come MATERIALE DI GATE, esattamente dei path che qualunque
# repo mette nel proprio `.gitignore`: `.env`, `.next/`, `.trueline/`, un `.gitignore`
# annidato. Se stessero sul disco col loro nome vero dentro il repo esterno:
#   - `.trueline/` e' gia' ignorato dal `.gitignore` di questo repo (riga 4);
#   - un `.gitignore` ANNIDATO vale anche per il repo esterno: `eval/scan-scope/declared/
#     .gitignore` con dentro `.env` e `backups/` renderebbe non-tracciabile il materiale
#     di gate della fixture stessa.
# In entrambi i casi la fixture verrebbe persa in silenzio al primo clone — e una fixture
# persa e' un gate vacuo che nessuno vede spegnersi (L-COL-006).
#
# Quindi: cio' che e' TRACCIATO e' `seed/`, dove ogni segmento di path che deve diventare
# un dot-file e' scritto `dot.<nome>`; cio' che GIRA e' `project/`, materializzato qui e
# ignorato dal repo esterno (riga `eval/scan-scope/*/project/` nel .gitignore). Niente
# viene perso: `project/` e' interamente DERIVATO da `seed/`.
#
# COSA FA, IN ORDINE, PER OGNI FIXTURE
#   1. materializza `project/` da `seed/` (`dot.X` -> `.X` in OGNI segmento di path);
#   2. inizializza l'inner-repo e committa i SOLI file non ignorati dal `.gitignore`
#      materializzato (`git add -A` rispetta il .gitignore: e' cio' che rende
#      `.env`/`backups/` GITIGNORATI e `src/lib/database.types.ts` TRACCIATO — la
#      ripartizione E' il materiale di gate dei sotto-test 2/4/7).
#
# L'inner `.git` NON serve a gitleaks (lo scope `working-tree` legge i file su disco): serve
# al keystone come PRECONDIZIONE VERIFICABILE. Senza, `scan_scope_check.mjs` non puo'
# provare che `database.types.ts` e' davvero tracciato ne' che `.env` e' davvero
# gitignorato, e in quel caso esce 2 (ambiente) — mai un verde, mai un rosso.
#
# Uso:   bash eval/scan-scope/provision_fixtures.sh
#        bash eval/scan-scope/provision_fixtures.sh --force   # rifa' da zero
#
# Idempotente: se `project/` esiste gia' con il suo `.git`, non rifa' nulla.
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$ROOT/eval/scan-scope"
FIXTURES="declared undeclared"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# Traduce un path RELATIVO di `seed/` nel path corrispondente di `project/`:
# ogni segmento che comincia per `dot.` perde il prefisso e guadagna il punto.
#   dot.trueline/scan-scope.json -> .trueline/scan-scope.json
#   dot.next/static/chunks/a.js  -> .next/static/chunks/a.js
#   src/app.ts                   -> src/app.ts
map_path() {
  printf '%s' "$1" | sed -e 's#^dot\.#.#' -e 's#/dot\.#/.#g'
}

for d in $FIXTURES; do
  seed="$BASE/$d/seed"
  project="$BASE/$d/project"

  if [ ! -d "$seed" ]; then
    echo "SKIP $d: seed assente ($seed) — i sorgenti della fixture non ci sono."
    continue
  fi

  if [ -e "$project/.git" ] && [ "$FORCE" -eq 0 ]; then
    echo "$d: project/ gia' provvigionato (HEAD=$(cd "$project" && git rev-parse --short HEAD))."
    continue
  fi

  # --force: si rade SOLO `project/`, che e' interamente derivato da `seed/`.
  # `seed/` (l'originale tracciato) non viene toccato mai.
  [ "$FORCE" -eq 1 ] && rm -rf "$project"
  mkdir -p "$project"

  # 1) materializzazione seed -> project, con la mappatura dei dot-file.
  (
    cd "$seed"
    find . -type f | sed 's#^\./##' | while IFS= read -r f; do
      dst="$project/$(map_path "$f")"
      mkdir -p "$(dirname "$dst")"
      cp "$f" "$dst"
    done
  )

  # 2) inner-repo: `git add -A` rispetta il `.gitignore` appena materializzato, quindi
  #    la ripartizione TRACCIATO/GITIGNORATO esce da sola dal contenuto della fixture.
  (
    cd "$project"
    git init -q
    git add -A
    GIT_AUTHOR_NAME="Scan Scope Fixture Bot" GIT_AUTHOR_EMAIL="fixture@trueline.local" \
    GIT_COMMITTER_NAME="Scan Scope Fixture Bot" GIT_COMMITTER_EMAIL="fixture@trueline.local" \
    GIT_AUTHOR_DATE="2026-07-28T00:00:00 +0000" GIT_COMMITTER_DATE="2026-07-28T00:00:00 +0000" \
    git commit -q -m "fixture scan-scope: stato iniziale ($d)"
  )

  tracked=$(cd "$project" && git ls-files | wc -l | tr -d ' ')
  echo "$d: project/ materializzato + inner .git creato (HEAD=$(cd "$project" && git rev-parse --short HEAD), file tracciati=$tracked)."
done

echo ""
echo "Fixture scan-scope provvigionate. Verifica rapida delle PRECONDIZIONI del keystone:"
echo "  declared: database.types.ts TRACCIATO   -> git -C eval/scan-scope/declared/project ls-files -- src/lib/database.types.ts"
echo "  declared: .env GITIGNORATO              -> git -C eval/scan-scope/declared/project check-ignore -v .env"
echo "  declared: backups/ GITIGNORATO          -> git -C eval/scan-scope/declared/project check-ignore -v backups/remote_data_2026_07_20.sql"
