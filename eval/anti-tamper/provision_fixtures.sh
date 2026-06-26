#!/usr/bin/env bash
# provision_fixtures.sh — FINALIZZA i 4 fixture AT-1 Fase A (passo d'ORCHESTRATORE).
#
# Gli agenti del Dynamic Workflow NON toccano git (L-COL-024): la creazione dell'inner-repo
# dei fixture e' quindi un passo dell'orchestratore, eseguito DOPO che il workflow ha
# costruito i sorgenti. Questo script lo MECCANIZZA in modo idempotente e riproducibile.
# Mirror di eval/build-discipline/provision_fixtures.sh, MA i fixture anti-tamper usano
# SOLO node:test (zero npm install): nessun node_modules da provvigionare offline, si
# committano i SOLI sorgenti (package.json/src/tests).
#
# Le reference-app sono gitignorate (eval/anti-tamper/*/reference-app/): l'inner .git resta
# su disco NON tracciato dal repo esterno, come per i pack fixtures di ecosystem e BD-1.
# I seeded-blueprint/ restano TRACKED (sono il materiale di gate del fixture).
#
# L'inner .git e' un PREREQUISITO del driver verify-fix: senza, assertIsolatedRepo del
# loop risolve al repo ESTERNO e createWorkBranch RIFIUTA (L-COL-024) — vedi
# eval/harness/anti_tamper_check.mjs (precondizione -> exit 2).
#
# Uso:  bash eval/anti-tamper/provision_fixtures.sh
# Idempotente: se .git esiste gia', non rifa nulla.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURES="faithful failing empty partial tampered-untagged tag-in-stringa ac-multi-file covers-scalare tag-spurio mixed-coverage"

for d in $FIXTURES; do
  app="$ROOT/eval/anti-tamper/$d/reference-app"
  if [ ! -d "$app" ]; then
    echo "SKIP $d: reference-app assente ($app) — ricostruisci prima i sorgenti del fixture."
    continue
  fi
  # inner .git: solo sorgenti tracciati (package.json/src/tests); zero node_modules.
  if [ ! -e "$app/.git" ]; then
    (
      cd "$app"
      git init -q
      git add package.json src tests
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

echo "Fixtures AT-1 Fase A+B finalizzati (inner .git, zero node_modules)."
