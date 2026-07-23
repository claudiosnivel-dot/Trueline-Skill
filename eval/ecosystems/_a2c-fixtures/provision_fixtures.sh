#!/usr/bin/env bash
# provision_fixtures.sh — FINALIZZA le fixture A2c (passo d'ORCHESTRATORE).
#
# Gli agenti del Dynamic Workflow NON toccano git (L-COL-024): la creazione
# dell'inner-repo dei fixture e' un passo dell'orchestratore, eseguito DOPO che il
# workflow ha costruito i sorgenti. Mirror di
# eval/ecosystems/_a2a-fixtures/provision_fixtures.sh, idempotente.
#
# DUE PRECONDIZIONI del keystone a2c_hygiene_activation_check (mai un verde finto,
# L-COL-006):
#   1) INNER .git per ogni fixture-leaf (gitleaks working-tree / driver verify-fix
#      risolvono al repo ESTERNO senza un inner .git; il gate rifiuta, L-COL-024).
#   2) node_modules/knip risolvibile in ogni leaf: control1Hygiene esegue SEMPRE il
#      dead-code (run_deadcode/knip) per PRIMO e knip NON ha fallback via npx —
#      richiede <leaf>/node_modules/knip/bin/knip.js con l'INTERO albero delle sue
#      dipendenze (un `cp -R` del solo pacchetto knip NON basta: mancherebbero le sue
#      transitive, es. `formatly`). Percio' provvigioniamo via `npm install` dalle
#      devDependencies del leaf, come A2a. jscpd/madge hanno il fallback npx nei loro
#      wrapper (funzionano anche senza node_modules), ma installarli project-local li
#      rende deterministici. La fase (2) e' best-effort: se npm e' offline senza cache
#      lo dichiara e prosegue (il keystone poi esce 2 = precondizione, mai falso verde).
set -e
here="$(cd "$(dirname "$0")" && pwd)"
LEAVES="dup-cycle-debt clean"

# --- Fase 1: inner .git (con .gitignore -> niente node_modules tracciati) ------
for fx in $LEAVES; do
  d="$here/$fx"
  [ -d "$d" ] || continue
  # Windows: un file NUL (nome riservato) rompe git add -A; rimuovilo se presente.
  rm -f "$d/NUL" 2>/dev/null || true
  if [ ! -e "$d/.git" ]; then
    (
      cd "$d"
      git init -q
      git add -A
      GIT_AUTHOR_NAME="Reference App Bot" GIT_AUTHOR_EMAIL="refapp@trueline.local" \
      GIT_COMMITTER_NAME="Reference App Bot" GIT_COMMITTER_EMAIL="refapp@trueline.local" \
      GIT_AUTHOR_DATE="2026-07-23T00:00:00 +0000" GIT_COMMITTER_DATE="2026-07-23T00:00:00 +0000" \
      git commit -q -m "fixture a2c: stato iniziale ($fx)"
    )
    echo "$fx: inner .git creato (HEAD=$(cd "$d" && git rev-parse --short HEAD))."
  else
    echo "$fx: inner .git gia' presente (HEAD=$(cd "$d" && git rev-parse --short HEAD))."
  fi
done

# --- Fase 2: node_modules project-local (knip obbligatorio; jscpd/madge utili) --
# best-effort: npm install dalle devDependencies di ogni leaf. Idempotente (salta i
# leaf che hanno gia' node_modules/knip). `--prefer-offline` per usare la cache npm.
if command -v npm >/dev/null 2>&1; then
  for fx in $LEAVES; do
    d="$here/$fx"
    [ -d "$d" ] || continue
    if [ -e "$d/node_modules/knip/bin/knip.js" ]; then
      echo "$fx: node_modules/knip gia' presente."
      continue
    fi
    echo "$fx: npm install (knip/jscpd/madge project-local) ..."
    ( cd "$d" && npm install --no-audit --no-fund --prefer-offline --silent ) \
      && echo "$fx: node_modules provisionati." \
      || echo "$fx: npm install FALLITO (offline senza cache?) — il keystone lo dichiarera' (exit 2)."
  done
else
  echo "npm non disponibile: salto la fase 2 (node_modules). knip e' obbligatorio per il keystone."
fi

echo "Fixtures A2c finalizzati (inner .git + node_modules best-effort)."
