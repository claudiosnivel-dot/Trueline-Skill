#!/usr/bin/env bash
# provision_fixtures.sh — FINALIZZA i 3 fixture BD-1 (passo d'ORCHESTRATORE).
#
# Gli agenti del Dynamic Workflow NON toccano git (L-COL-024): la creazione dell'inner-repo
# dei fixture e' quindi un passo dell'orchestratore, eseguito DOPO che il workflow ha
# costruito i sorgenti (T1.3). Questo script lo MECCANIZZA in modo idempotente e
# riproducibile. Mirror esatto del fixture canonico eval/reference-app:
#   - node_modules provvigionato per COPIA OFFLINE dal canonico (knip + typescript),
#     MAI `npm install` di rete (invariante di build BD-1);
#   - inner .git con i SOLI sorgenti tracciati (package.json/tsconfig.json/knip.json/src),
#     node_modules e package-lock UNTRACKED (identico al canonico).
# Le reference-app sono gitignorate (eval/build-discipline/*/reference-app/): node_modules
# e .git restano su disco NON tracciati, come per i pack fixtures di ecosystem.
#
# L'inner .git e' un PREREQUISITO del driver verify-fix: senza, assertIsolatedRepo del
# loop risolve al repo ESTERNO e createWorkBranch RIFIUTA (L-COL-024) — vedi
# eval/harness/build_discipline_check.mjs (precondizione -> exit 2).
#
# Uso:  bash eval/build-discipline/provision_fixtures.sh
# Idempotente: se .git/node_modules esistono gia', non rifa nulla.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CANON_NM="$ROOT/eval/reference-app/node_modules"
FIXTURES="overcomplicated-correct orphan-injecting ambiguous-ac"

for d in $FIXTURES; do
  app="$ROOT/eval/build-discipline/$d/reference-app"
  if [ ! -d "$app" ]; then
    echo "SKIP $d: reference-app assente ($app) — ricostruisci prima i sorgenti del fixture (T1.3)."
    continue
  fi
  # 1) node_modules OFFLINE (knip + typescript), mai npm di rete.
  if [ ! -e "$app/node_modules/knip/bin/knip.js" ]; then
    if [ ! -d "$CANON_NM" ]; then
      echo "ERRORE $d: node_modules canonico assente ($CANON_NM) — impossibile provvigionare offline."
      exit 1
    fi
    cp -R "$CANON_NM" "$app/node_modules"
    echo "$d: node_modules provvigionato per copia OFFLINE dal canonico."
  fi
  # 2) inner .git (solo sorgenti tracciati; node_modules untracked come il canonico).
  if [ ! -e "$app/.git" ]; then
    (
      cd "$app"
      git init -q
      git add package.json tsconfig.json knip.json src
      GIT_AUTHOR_NAME="Reference App Bot" GIT_AUTHOR_EMAIL="refapp@trueline.local" \
      GIT_COMMITTER_NAME="Reference App Bot" GIT_COMMITTER_EMAIL="refapp@trueline.local" \
      GIT_AUTHOR_DATE="2026-06-24T00:00:00 +0000" GIT_COMMITTER_DATE="2026-06-24T00:00:00 +0000" \
      git commit -q -m "fixture: stato iniziale pulito ($d)"
    )
    echo "$d: inner .git creato (HEAD=$(cd "$app" && git rev-parse --short HEAD))."
  else
    echo "$d: inner .git gia' presente (HEAD=$(cd "$app" && git rev-parse --short HEAD))."
  fi
done

echo "Fixtures BD-1 finalizzati (node_modules offline + inner .git)."
