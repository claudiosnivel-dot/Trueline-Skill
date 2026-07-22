#!/usr/bin/env bash
# provision_fixtures.sh — FINALIZZA le fixture A2b (passo d'ORCHESTRATORE, L-COL-024).
#
# Gli agenti del Dynamic Workflow NON toccano git: la provisione dei node_modules
# project-local è quindi un passo dell'orchestratore, eseguito DOPO che i sorgenti
# sono costruiti. Mirror semplificato di _a2a-fixtures/provision_fixtures.sh.
#
# PRECONDIZIONE del keystone a2b_arch_check (mai un verde finto, L-COL-006): ogni
# fixture ha node_modules/knip risolvibile (run_deadcode, controllo 1 sempre-attivo,
# senza fallback npx) e node_modules/madge (arch_check via buildModuleGraph;
# fallback npx disponibile ma project-local = deterministico). Best-effort: se npm
# non è disponibile/offline, lo dichiara e prosegue (il keystone fallirà onestamente
# sui fixture senza knip — mai un falso verde). NB: le fixture A2b non richiedono un
# inner .git (arch_check/knip/twin non usano git; gitleaks è nel controllo 2).
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIX="$ROOT/eval/ecosystems/_a2b-fixtures"
LEAVES="direct transitive transitive-direct conformant vacuous-deadrule allowlisted"

if command -v npm >/dev/null 2>&1; then
  for leaf in $LEAVES; do
    app="$FIX/$leaf"
    [ -d "$app" ] || continue
    rm -f "$app/NUL" 2>/dev/null || true
    if [ -e "$app/node_modules/knip/bin/knip.js" ] && [ -e "$app/node_modules/madge/bin/cli.js" ]; then
      echo "$leaf: node_modules gia' presenti."
      continue
    fi
    echo "$leaf: npm install (knip/madge project-local) ..."
    ( cd "$app" && npm install --no-audit --no-fund --silent ) \
      && echo "$leaf: node_modules provisionati." \
      || echo "$leaf: npm install FALLITO (offline senza cache?) — il keystone lo dichiarera'."
  done
else
  echo "npm non disponibile: salto la provisione. knip/madge sono obbligatori per il keystone."
fi
echo "Fixtures A2b finalizzati (node_modules best-effort)."
