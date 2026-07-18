#!/usr/bin/env bash
# provision_fixtures.sh — FINALIZZA le fixture A2a (passo d'ORCHESTRATORE).
#
# Gli agenti del Dynamic Workflow NON toccano git (L-COL-024): la creazione
# dell'inner-repo dei fixture e' quindi un passo dell'orchestratore, eseguito DOPO
# che il workflow ha costruito i sorgenti. Mirror di
# eval/ecosystems/_a0-fixtures/provision_fixtures.sh, idempotente.
#
# DUE PRECONDIZIONI del keystone a2a_hygiene_check (mai un verde finto, L-COL-006):
#   1) INNER .git per ogni fixture-leaf (dup/cycle/twin/clean): gitleaks working-tree
#      e il driver verify-fix risolvono al repo ESTERNO senza un inner .git, e il
#      gate rifiuta (L-COL-024). Il .gitignore di ogni leaf tiene node_modules/dist
#      FUORI dal commit (zero node_modules tracciati).
#   2) node_modules/knip risolvibile in ogni leaf: run_deadcode (controllo 1
#      sempre-attivo) NON ha fallback via npx e richiede
#      <leaf>/node_modules/knip/bin/knip.js. jscpd/madge si risolvono anche via la
#      cache di npx (i wrapper hanno il fallback), ma installarli project-local li
#      rende deterministici e veloci. La fase (2) e' best-effort: se npm non e'
#      disponibile/offline senza cache, lo dichiara e prosegue (il keystone poi
#      fallira' onestamente sui leaf senza knip — mai un falso verde).
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIX="$ROOT/eval/ecosystems/_a2a-fixtures"

LEAVES="dup cycle twin clean"

# --- Fase 1: inner .git (con .gitignore -> niente node_modules tracciati) ------
for leaf in $LEAVES; do
  app="$FIX/$leaf"
  [ -d "$app" ] || continue
  # Windows: un file NUL (nome riservato) rompe git add -A; rimuovilo se presente.
  rm -f "$app/NUL" 2>/dev/null || true
  if [ ! -e "$app/.git" ]; then
    (
      cd "$app"
      git init -q
      git add -A
      GIT_AUTHOR_NAME="Reference App Bot" GIT_AUTHOR_EMAIL="refapp@trueline.local" \
      GIT_COMMITTER_NAME="Reference App Bot" GIT_COMMITTER_EMAIL="refapp@trueline.local" \
      GIT_AUTHOR_DATE="2026-07-18T00:00:00 +0000" GIT_COMMITTER_DATE="2026-07-18T00:00:00 +0000" \
      git commit -q -m "fixture a2a: stato iniziale ($leaf)"
    )
    echo "$leaf: inner .git creato (HEAD=$(cd "$app" && git rev-parse --short HEAD))."
  else
    echo "$leaf: inner .git gia' presente (HEAD=$(cd "$app" && git rev-parse --short HEAD))."
  fi
done

# --- Fase 2: node_modules project-local (knip obbligatorio; jscpd/madge utili) --
# best-effort: npm install dalle devDependencies di ogni leaf. Idempotente
# (salta i leaf che hanno gia' node_modules/knip).
if command -v npm >/dev/null 2>&1; then
  for leaf in $LEAVES; do
    app="$FIX/$leaf"
    [ -d "$app" ] || continue
    if [ -e "$app/node_modules/knip/bin/knip.js" ]; then
      echo "$leaf: node_modules/knip gia' presente."
      continue
    fi
    echo "$leaf: npm install (knip/jscpd/madge project-local) ..."
    ( cd "$app" && npm install --no-audit --no-fund --silent ) \
      && echo "$leaf: node_modules provisionati." \
      || echo "$leaf: npm install FALLITO (offline senza cache?) — il keystone lo dichiarera'."
  done
else
  echo "npm non disponibile: salto la fase 2 (node_modules). knip e' obbligatorio per il keystone."
fi

echo "Fixtures A2a finalizzati (inner .git + node_modules best-effort)."
