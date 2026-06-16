#!/usr/bin/env bash
# =============================================================================
# eval/db-test/up.sh — bring-up idempotente del DB di test Supabase
#                      (Linux / macOS / WSL). Mirror di up.ps1.
#
# Banco di prova RLS (proof S5, contrasto S3/S4). Idempotente e ripetibile:
#   1. verifica che Docker sia in esecuzione;
#   2. verifica la CLI supabase 2.106 + il companion supabase-go;
#   3. assicura il symlink supabase/migrations -> ../../reference-app/...;
#   4. assicura il config attivo supabase/config.toml;
#   5. avvia lo stack con `supabase start --workdir <dir>` SOLO se e giu;
#   6. applica la migration seminata (0001_init.sql) se non gia presente.
#
#   project_id = "trueline-db-test"; porte +100 (api=54421 db=54422 ...).
#   DB URL: postgresql://postgres:postgres@127.0.0.1:54422/postgres
#
# FLAG:
#   --down    ferma lo stack (supabase stop) e esce
#   --reset   ricrea pulito: stop + start + riapplica la migration
#   --proof   esegue la prova empirica S5 (proof_s5.sql) e mostra il leak
# =============================================================================
set -euo pipefail

# --- flag ---
DOWN=0; RESET=0; PROOF=0
for arg in "$@"; do
  case "$arg" in
    --down)  DOWN=1 ;;
    --reset) RESET=1 ;;
    --proof) PROOF=1 ;;
    *) echo "Flag sconosciuto: $arg (usa --down|--reset|--proof)"; exit 2 ;;
  esac
done

# --- percorsi ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKDIR_REL="eval/db-test"
SUPABASE_DIR="${SCRIPT_DIR}/supabase"
MIGRATIONS_LINK="${SUPABASE_DIR}/migrations"
MIGRATIONS_TGT="${EVAL_DIR}/reference-app/supabase/migrations"
ACTIVE_CONFIG="${SUPABASE_DIR}/config.toml"
PROOF_SQL="${SCRIPT_DIR}/proof_s5.sql"
PROJECT_ID="trueline-db-test"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
PINNED_IMAGE="public.ecr.aws/supabase/postgres:17.6.1.134"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"

step() { printf '==> %s\n' "$1"; }
ok()   { printf '    %s\n' "$1"; }
fail() { printf 'ERRORE: %s\n' "$1" >&2; exit 1; }

stack_up() {
  [ -n "$(docker ps --filter "name=${DB_CONTAINER}" --filter "status=running" --format '{{.Names}}')" ]
}

echo "=== Trueline -- DB di test (Supabase locale, ${PROJECT_ID}) ==="
echo "Workdir:   ${WORKDIR_REL}"
echo "DB URL:    ${DB_URL}"
echo ""

# --- --down ---
if [ "$DOWN" -eq 1 ]; then
  step "Stop dello stack (supabase stop --workdir ${WORKDIR_REL})..."
  supabase stop --workdir "${WORKDIR_REL}" || true
  ok "Stack fermato."
  exit 0
fi

# --- 1. Docker ---
step "[1/6] Verifica Docker..."
if ! docker info >/dev/null 2>&1; then
  fail "Docker non e in esecuzione. Avvia Docker e riprova. (Senza Docker i controlli RLS runtime degradano al checker statico — vedi README.md.)"
fi
ok "Docker OK."

# --- 2. supabase CLI + companion ---
step "[2/6] Verifica supabase CLI (+ companion supabase-go)..."
if ! command -v supabase >/dev/null 2>&1; then
  fail "supabase CLI non trovato nel PATH (atteso 2.106.0). Non reinstallare se gia presente altrove."
fi
ok "supabase CLI: $(supabase --version 2>/dev/null | head -1)"
SUPA_BIN="$(command -v supabase)"
SUPA_DIR="$(dirname "${SUPA_BIN}")"
if [ -x "${SUPA_DIR}/supabase-go" ] || [ -x "${SUPA_DIR}/supabase-go.exe" ]; then
  ok "companion supabase-go presente accanto allo shim."
else
  echo "    ATTENZIONE: supabase-go non trovato accanto a ${SUPA_BIN}; alcune sottoazioni 2.106 potrebbero fallire." >&2
fi

# --- 3. Symlink migrations (idempotente) ---
step "[3/6] Assicura il symlink migrations..."
[ -d "${MIGRATIONS_TGT}" ] || fail "Target migration mancante: ${MIGRATIONS_TGT}"
mkdir -p "${SUPABASE_DIR}"
if [ -L "${MIGRATIONS_LINK}" ]; then
  ok "Symlink gia presente -> $(readlink "${MIGRATIONS_LINK}")"
elif [ -e "${MIGRATIONS_LINK}" ]; then
  echo "    'migrations' esiste ma non e un symlink: lo ricreo." >&2
  rm -rf "${MIGRATIONS_LINK}"
  ln -s "../../reference-app/supabase/migrations" "${MIGRATIONS_LINK}"
  ok "Symlink ricreato."
else
  ln -s "../../reference-app/supabase/migrations" "${MIGRATIONS_LINK}"
  ok "Symlink creato: migrations -> ../../reference-app/supabase/migrations"
fi

# --- 4. Config attivo ---
step "[4/6] Verifica config attivo (supabase/config.toml)..."
[ -f "${ACTIVE_CONFIG}" ] || fail "Config attivo mancante: ${ACTIVE_CONFIG} (schema CLI 2.106, project_id=${PROJECT_ID})."
ok "Config presente: ${ACTIVE_CONFIG}"

# --- 5. Avvio (solo se giu); --reset forza stop+start ---
step "[5/6] Stato dello stack..."
if [ "$RESET" -eq 1 ]; then
  echo "    --reset richiesto: stop + start." >&2
  supabase stop --workdir "${WORKDIR_REL}" >/dev/null 2>&1 || true
fi
if [ "$RESET" -eq 0 ] && stack_up; then
  ok "Stack gia in esecuzione (${DB_CONTAINER}): non riavvio."
else
  echo "    Stack giu: avvio con immagine fissata ${PINNED_IMAGE}..." >&2
  supabase start --workdir "${WORKDIR_REL}"
  deadline=$(( $(date +%s) + 120 ))
  until docker exec "${DB_CONTAINER}" pg_isready -U postgres -d postgres >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "Il DB non e diventato pronto entro il timeout."
    sleep 2
  done
  ok "Stack avviato e DB pronto."
fi

# --- 6. Assicura la migration applicata (idempotente) ---
step "[6/6] Assicura la migration seminata (0001_init.sql)..."
TBL_COUNT="$(docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('profiles','notes','audit_logs','documents','invoices');" | tr -d '[:space:]')"
if [ "${TBL_COUNT}" = "5" ]; then
  ok "Schema gia presente (5/5 tabelle): nessuna riapplicazione."
else
  echo "    Tabelle presenti: ${TBL_COUNT}/5. Applico 0001_init.sql..." >&2
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "${MIGRATIONS_LINK}/0001_init.sql"
  ok "Migration applicata."
fi

echo ""
echo "=== DB di test pronto ==="
echo "  supabase status --workdir ${WORKDIR_REL}"
echo "  DB URL: ${DB_URL}"
echo ""

# --- --proof ---
if [ "$PROOF" -eq 1 ]; then
  step "Esecuzione prova empirica S5 (proof_s5.sql)..."
  [ -f "${PROOF_SQL}" ] || fail "proof_s5.sql mancante: ${PROOF_SQL}"
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "${PROOF_SQL}"
  echo ""
  ok "Prova S5 completata (vedi output: LEAK invoices + contrasto notes)."
fi

exit 0
