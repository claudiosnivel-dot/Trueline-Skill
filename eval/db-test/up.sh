#!/usr/bin/env bash
# =============================================================================
# eval/db-test/up.sh — avvio del DB di test Supabase locale (Linux/macOS/WSL)
#
# SCOPO (USO FUTURO — M0/M3): questo script non viene eseguito in M-1.
# Quando il DB di test sara necessario (milestone M0/M3), eseguire:
#   bash eval/db-test/up.sh
# dalla root del workspace.
#
# COSA FA:
#   1. Verifica che Docker sia in esecuzione (prerequisito supabase-CLI).
#   2. Installa supabase-CLI tramite npm (una-tantum, se mancante).
#   3. Avvia l'istanza Supabase locale con "supabase start".
#   4. Applica le migration dalla reference app.
#
# NOTA DI DEGRADAZIONE (06 §6.1 / 10 §2):
#   Se Docker o supabase-CLI non sono disponibili, i controlli RLS
#   DEGRADANO al checker statico. Vedere eval/db-test/README.md per i dettagli.
#
# RIFERIMENTI:
#   - eval/db-test/config.toml  (config Supabase locale)
#   - eval/reference-app/supabase/migrations/  (migration schema)
#   - 06-CHARACTERIZATION-TESTS §6.1, 10-EVALUATION §2
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATIONS_DIR="${WORKSPACE_ROOT}/eval/reference-app/supabase/migrations"
SUPABASE_PROJECT_DIR="${SCRIPT_DIR}"

echo "=== Trueline — DB di test (Supabase locale) ==="
echo "Workspace root:  ${WORKSPACE_ROOT}"
echo "Migration dir:   ${MIGRATIONS_DIR}"
echo ""

# ---------------------------------------------------------------------------
# 1. Verifica Docker
# ---------------------------------------------------------------------------
echo "[1/4] Verifica Docker..."
if ! docker info >/dev/null 2>&1; then
  echo "ERRORE: Docker non e in esecuzione o non e installato."
  echo "       Installa Docker Desktop e avvialo prima di procedere."
  echo ""
  echo "DEGRADAZIONE: senza Docker i controlli RLS runtime (S5, S3/S4 comportamentali)"
  echo "              degradano al checker statico. Vedere README.md."
  exit 1
fi
echo "  Docker OK."

# ---------------------------------------------------------------------------
# 2. Installa supabase-CLI se mancante
# ---------------------------------------------------------------------------
echo "[2/4] Verifica supabase-CLI..."
if ! command -v supabase >/dev/null 2>&1; then
  echo "  supabase-CLI non trovato. Installazione via npm..."
  npm install -g supabase
  echo "  supabase-CLI installato."
else
  SUPABASE_VERSION="$(supabase --version 2>&1 | head -1)"
  echo "  supabase-CLI gia presente: ${SUPABASE_VERSION}"
fi

# ---------------------------------------------------------------------------
# 3. Avvia Supabase locale
# ---------------------------------------------------------------------------
echo "[3/4] Avvio Supabase locale..."
cd "${SUPABASE_PROJECT_DIR}"

# Crea la directory supabase attesa dalla CLI se non esiste,
# e copia (o linka) il config.toml dove la CLI lo cerca.
if [ ! -d "${SUPABASE_PROJECT_DIR}/supabase" ]; then
  mkdir -p "${SUPABASE_PROJECT_DIR}/supabase"
fi
cp "${SUPABASE_PROJECT_DIR}/config.toml" "${SUPABASE_PROJECT_DIR}/supabase/config.toml"

supabase start --workdir "${SUPABASE_PROJECT_DIR}"
echo "  Supabase avviato."

# ---------------------------------------------------------------------------
# 4. Applica le migration dalla reference app
# ---------------------------------------------------------------------------
echo "[4/4] Applicazione migration da ${MIGRATIONS_DIR}..."

# Recupera la stringa di connessione dall'istanza locale appena avviata.
DB_URL="$(supabase status --workdir "${SUPABASE_PROJECT_DIR}" | grep 'DB URL' | awk '{print $NF}')"

if [ -z "${DB_URL}" ]; then
  echo "  ATTENZIONE: impossibile ricavare il DB URL da 'supabase status'."
  echo "  Applicare le migration manualmente con:"
  echo "    supabase db push --db-url <DB_URL> --local"
else
  supabase db push \
    --db-url "${DB_URL}" \
    --local \
    --workdir "${SUPABASE_PROJECT_DIR}"
  echo "  Migration applicate."
fi

echo ""
echo "=== DB di test pronto ==="
echo "Connessione locale: ${DB_URL:-'<ricavare da: supabase status>'}"
echo ""
echo "DIFETTI ESERCITABILI A RUNTIME:"
echo "  S3 — audit_logs senza RLS  (visibile via query diretta)"
echo "  S4 — documents con USING (true)  (isolamento finto verificabile)"
echo "  S5 — invoices multi-tenant senza vincolo auth.uid()/tenant_id"
echo ""
echo "Per fermare: supabase stop --workdir ${SUPABASE_PROJECT_DIR}"
