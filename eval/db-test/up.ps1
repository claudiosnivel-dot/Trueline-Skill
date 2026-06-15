# =============================================================================
# eval/db-test/up.ps1 — avvio del DB di test Supabase locale (Windows PowerShell)
#
# SCOPO (USO FUTURO — M0/M3): questo script non viene eseguito in M-1.
# Quando il DB di test sara necessario (milestone M0/M3), eseguire:
#   .\eval\db-test\up.ps1
# dalla root del workspace (PowerShell 5.1+).
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

$ErrorActionPreference = 'Stop'

$ScriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$MigrationsDir = Join-Path $WorkspaceRoot 'eval\reference-app\supabase\migrations'
$ProjectDir    = $ScriptDir

Write-Host "=== Trueline -- DB di test (Supabase locale) ==="
Write-Host "Workspace root:  $WorkspaceRoot"
Write-Host "Migration dir:   $MigrationsDir"
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Verifica Docker
# ---------------------------------------------------------------------------
Write-Host "[1/4] Verifica Docker..."
try {
    docker info | Out-Null
    Write-Host "  Docker OK."
} catch {
    Write-Host "ERRORE: Docker non e in esecuzione o non e installato."
    Write-Host "        Installa Docker Desktop e avvialo prima di procedere."
    Write-Host ""
    Write-Host "DEGRADAZIONE: senza Docker i controlli RLS runtime (S5, S3/S4 comportamentali)"
    Write-Host "              degradano al checker statico. Vedere README.md."
    exit 1
}

# ---------------------------------------------------------------------------
# 2. Installa supabase-CLI se mancante
# ---------------------------------------------------------------------------
Write-Host "[2/4] Verifica supabase-CLI..."
$supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCmd) {
    Write-Host "  supabase-CLI non trovato. Installazione via npm..."
    npm install -g supabase
    Write-Host "  supabase-CLI installato."
} else {
    $ver = (supabase --version 2>&1 | Select-Object -First 1)
    Write-Host "  supabase-CLI gia presente: $ver"
}

# ---------------------------------------------------------------------------
# 3. Avvia Supabase locale
# ---------------------------------------------------------------------------
Write-Host "[3/4] Avvio Supabase locale..."

# Crea la directory supabase attesa dalla CLI se non esiste,
# e copia il config.toml dove la CLI lo cerca.
$SupabaseSubDir = Join-Path $ProjectDir 'supabase'
if (-not (Test-Path $SupabaseSubDir)) {
    New-Item -ItemType Directory -Path $SupabaseSubDir | Out-Null
}
Copy-Item -Path (Join-Path $ProjectDir 'config.toml') `
          -Destination (Join-Path $SupabaseSubDir 'config.toml') `
          -Force

supabase start --workdir $ProjectDir
Write-Host "  Supabase avviato."

# ---------------------------------------------------------------------------
# 4. Applica le migration dalla reference app
# ---------------------------------------------------------------------------
Write-Host "[4/4] Applicazione migration da $MigrationsDir..."

# Recupera la stringa di connessione dall'istanza locale appena avviata.
$statusOutput = supabase status --workdir $ProjectDir 2>&1
$dbUrlLine    = $statusOutput | Select-String 'DB URL'
$DbUrl        = if ($dbUrlLine) { ($dbUrlLine -split '\s+')[-1] } else { '' }

if ([string]::IsNullOrEmpty($DbUrl)) {
    Write-Host "  ATTENZIONE: impossibile ricavare il DB URL da 'supabase status'."
    Write-Host "  Applicare le migration manualmente con:"
    Write-Host "    supabase db push --db-url <DB_URL> --local"
} else {
    supabase db push `
        --db-url $DbUrl `
        --local `
        --workdir $ProjectDir
    Write-Host "  Migration applicate."
}

Write-Host ""
Write-Host "=== DB di test pronto ==="
Write-Host "Connessione locale: $(if ($DbUrl) { $DbUrl } else { '<ricavare da: supabase status>' })"
Write-Host ""
Write-Host "DIFETTI ESERCITABILI A RUNTIME:"
Write-Host "  S3 -- audit_logs senza RLS  (visibile via query diretta)"
Write-Host "  S4 -- documents con USING (true)  (isolamento finto verificabile)"
Write-Host "  S5 -- invoices multi-tenant senza vincolo auth.uid()/tenant_id"
Write-Host ""
Write-Host "Per fermare: supabase stop --workdir $ProjectDir"
