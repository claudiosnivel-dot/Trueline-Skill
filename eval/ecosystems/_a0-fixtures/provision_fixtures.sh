#!/usr/bin/env bash
# provision_fixtures.sh — FINALIZZA le fixture A0 (passo d'ORCHESTRATORE).
#
# Gli agenti del Dynamic Workflow NON toccano git (L-COL-024): la creazione
# dell'inner-repo dei fixture e' quindi un passo dell'orchestratore, eseguito DOPO
# che il workflow ha costruito i sorgenti. Mirror di
# eval/anti-tamper/provision_fixtures.sh, idempotente.
#
# L'inner .git e' un PREREQUISITO del checkpoint/loop: gitleaks working-tree e il
# driver verify-fix risolvono al repo ESTERNO senza un inner .git, e il gate
# rifiuta (L-COL-024). Ogni fixture-leaf (open/scoped/shipit e, dal Task 4, le
# fixture _structural/*) riceve un inner .git con i SOLI sorgenti (zero node_modules
# tracciati: il provisioning offline dei node_modules e' un passo separato).
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIX="$ROOT/eval/ecosystems/_a0-fixtures"

PACKS="firebase-jsts firebase-py appwrite-jsts pocketbase-jsts hasura-jsts amplify-jsts"

# Leaf fixture: pack/{open,scoped}, la shipit firebase, e le strutturali (Task 4).
LEAVES=""
for p in $PACKS; do
  LEAVES="$LEAVES $p/open $p/scoped"
done
LEAVES="$LEAVES firebase-jsts/shipit _structural/floor _structural/nonfloor"

for leaf in $LEAVES; do
  app="$FIX/$leaf"
  if [ ! -d "$app" ]; then
    # _structural non esiste finche' il Task 4 non lo crea: skip silenzioso.
    continue
  fi
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
      git commit -q -m "fixture a0: stato iniziale ($leaf)"
    )
    echo "$leaf: inner .git creato (HEAD=$(cd "$app" && git rev-parse --short HEAD))."
  else
    echo "$leaf: inner .git gia' presente (HEAD=$(cd "$app" && git rev-parse --short HEAD))."
  fi
done

echo "Fixtures A0 finalizzati (inner .git)."
