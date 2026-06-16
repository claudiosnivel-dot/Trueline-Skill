#requires -Version 5.1
<#
.SYNOPSIS
  eval/db-test/up.ps1 -- bring-up idempotente del DB di test Supabase (Windows).

.DESCRIPTION
  Banco di prova RLS (proof S5, contrasto S3/S4). Idempotente e ripetibile:
    1. verifica che Docker sia in esecuzione;
    2. verifica la CLI supabase 2.106 + il companion supabase-go;
    3. assicura la junction supabase/migrations -> ../../reference-app/...;
    4. assicura il config attivo supabase/config.toml;
    5. avvia lo stack con `supabase start --workdir <dir>` SOLO se e giu;
    6. applica la migration seminata (0001_init.sql) se non gia presente.

  project_id = "trueline-db-test"; porte +100 (api=54421 db=54422 ...).
  DB URL: postgresql://postgres:postgres@127.0.0.1:54422/postgres

.PARAMETER Down
  Ferma lo stack (`supabase stop`) e esce.

.PARAMETER Reset
  Ricrea pulito: stop + start (la CLI ricrea i volumi) e riapplica la migration.

.PARAMETER Proof
  Esegue la prova empirica S5 (proof_s5.sql) e mostra il leak + il contrasto.

.NOTES
  Le chiamate a eseguibili nativi NON usano 2>&1 (eviterebbe il falso-errore
  "stderr-as-error" di PowerShell): si controlla sempre $LASTEXITCODE.
#>
[CmdletBinding()]
param(
    [switch]$Down,
    [switch]$Reset,
    [switch]$Proof
)

$ErrorActionPreference = 'Stop'

# --- percorsi (assoluti, indipendenti dalla cwd) -----------------------------
$ScriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$EvalDir       = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$WorkdirRel    = 'eval/db-test'
$SupabaseDir   = Join-Path $ScriptDir 'supabase'
$MigrationsLink= Join-Path $SupabaseDir 'migrations'
$MigrationsTgt = Join-Path $EvalDir 'reference-app\supabase\migrations'
$ActiveConfig  = Join-Path $SupabaseDir 'config.toml'
$ProofSql      = Join-Path $ScriptDir 'proof_s5.sql'
$ProjectId     = 'trueline-db-test'
$DbContainer   = "supabase_db_$ProjectId"
$PinnedImage   = 'public.ecr.aws/supabase/postgres:17.6.1.134'
$DbUrl         = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres'

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok  ([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Fail      ([string]$msg) { Write-Host "ERRORE: $msg" -ForegroundColor Red; exit 1 }

# Esegue un nativo SENZA 2>&1 e fallisce solo se $LASTEXITCODE != 0.
function Invoke-Native {
    param([scriptblock]$Cmd, [string]$What)
    & $Cmd
    if ($LASTEXITCODE -ne 0) { Fail "$What (exit $LASTEXITCODE)" }
}

# Verifica che il container DB sia su (psql risponde).
function Test-StackUp {
    $running = (& docker ps --filter "name=$DbContainer" --filter "status=running" --format "{{.Names}}")
    return [bool]$running
}

Write-Host "=== Trueline -- DB di test (Supabase locale, $ProjectId) ===" -ForegroundColor White
Write-Host "Workdir:   $WorkdirRel"
Write-Host "DB URL:    $DbUrl"
Write-Host ""

# ---------------------------------------------------------------------------
# Flag -Down: ferma e esci.
# ---------------------------------------------------------------------------
if ($Down) {
    Write-Step "Stop dello stack (supabase stop --workdir $WorkdirRel)..."
    & supabase stop --workdir $WorkdirRel
    Write-Ok "Stack fermato (exit $LASTEXITCODE)."
    exit 0
}

# ---------------------------------------------------------------------------
# 1. Docker
# ---------------------------------------------------------------------------
Write-Step "[1/6] Verifica Docker..."
& docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "Docker non e in esecuzione. Avvia Docker Desktop e riprova. (Senza Docker i controlli RLS runtime degradano al checker statico - vedi README.md.)"
}
Write-Ok "Docker OK."

# ---------------------------------------------------------------------------
# 2. supabase CLI + companion supabase-go
# ---------------------------------------------------------------------------
Write-Step "[2/6] Verifica supabase CLI (+ companion supabase-go)..."
$supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCmd) {
    Fail "supabase CLI non trovato nel PATH. Atteso uno shim in C:\Users\<utente>\go\bin (supabase.exe 2.106.0). Non reinstallare se gia presente."
}
$ver = (& supabase --version | Select-Object -First 1)
Write-Ok "supabase CLI: $ver"

# Il companion supabase-go.exe deve stare accanto allo shim (stesso requisito 2.106).
$goCompanion = Join-Path (Split-Path -Parent $supabaseCmd.Source) 'supabase-go.exe'
if (Test-Path $goCompanion) {
    Write-Ok "companion supabase-go presente: $goCompanion"
} else {
    Write-Host "    ATTENZIONE: supabase-go.exe non trovato accanto a $($supabaseCmd.Source). Alcune sottoazioni della CLI 2.106 potrebbero fallire." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 3. Junction supabase/migrations -> ../../reference-app/supabase/migrations
#    (le junction possono non sopravvivere a un checkout: ricreazione idempotente)
# ---------------------------------------------------------------------------
Write-Step "[3/6] Assicura la junction migrations..."
if (-not (Test-Path $MigrationsTgt)) {
    Fail "Target migration mancante: $MigrationsTgt"
}
if (-not (Test-Path $SupabaseDir)) { New-Item -ItemType Directory -Path $SupabaseDir | Out-Null }

$needLink = $true
if (Test-Path $MigrationsLink) {
    $item = Get-Item $MigrationsLink -Force
    if ($item.LinkType -eq 'Junction') {
        $needLink = $false
        Write-Ok "Junction gia presente -> $($item.Target -join ', ')"
    } else {
        # Esiste ma NON e una junction (es. dir reale o file): rimuovi e ricrea.
        Write-Host "    'migrations' esiste ma non e una junction: la ricreo." -ForegroundColor Yellow
        Remove-Item $MigrationsLink -Recurse -Force
    }
}
if ($needLink) {
    New-Item -ItemType Junction -Path $MigrationsLink -Target $MigrationsTgt | Out-Null
    Write-Ok "Junction creata: migrations -> $MigrationsTgt"
}

# ---------------------------------------------------------------------------
# 4. Config attivo
# ---------------------------------------------------------------------------
Write-Step "[4/6] Verifica config attivo (supabase/config.toml)..."
if (-not (Test-Path $ActiveConfig)) {
    Fail "Config attivo mancante: $ActiveConfig (atteso schema CLI 2.106 con project_id=$ProjectId)."
}
Write-Ok "Config presente: $ActiveConfig"

# ---------------------------------------------------------------------------
# 5. Avvio (solo se giu). -Reset forza stop+start.
# ---------------------------------------------------------------------------
Write-Step "[5/6] Stato dello stack..."
$up = Test-StackUp
if ($Reset) {
    Write-Host "    -Reset richiesto: stop + start." -ForegroundColor Yellow
    & supabase stop --workdir $WorkdirRel | Out-Null
    $up = $false
}
if ($up) {
    Write-Ok "Stack gia in esecuzione ($DbContainer): non riavvio."
} else {
    Write-Host "    Stack giu: avvio con immagine fissata $PinnedImage..." -ForegroundColor Yellow
    Invoke-Native { & supabase start --workdir $WorkdirRel } "supabase start"
    # Attendi che il DB risponda.
    $deadline = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Seconds 2
        & docker exec $DbContainer pg_isready -U postgres -d postgres | Out-Null
        $ready = ($LASTEXITCODE -eq 0)
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if (-not $ready) { Fail "Il DB non e diventato pronto entro il timeout." }
    Write-Ok "Stack avviato e DB pronto."
}

# ---------------------------------------------------------------------------
# 6. Assicura la migration applicata (idempotente: applica solo se mancano tab.)
# ---------------------------------------------------------------------------
Write-Step "[6/6] Assicura la migration seminata (0001_init.sql)..."
$tblCount = (& docker exec $DbContainer psql -U postgres -d postgres -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('profiles','notes','audit_logs','documents','invoices');").Trim()
if ($tblCount -eq '5') {
    Write-Ok "Schema gia presente (5/5 tabelle): nessuna riapplicazione."
} else {
    Write-Host "    Tabelle presenti: $tblCount/5. Applico 0001_init.sql..." -ForegroundColor Yellow
    $mig = Join-Path $MigrationsLink '0001_init.sql'
    Get-Content -Raw $mig | & docker exec -i $DbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
    if ($LASTEXITCODE -ne 0) { Fail "Applicazione migration fallita (exit $LASTEXITCODE)." }
    Write-Ok "Migration applicata."
}

Write-Host ""
Write-Host "=== DB di test pronto ===" -ForegroundColor White
Write-Host "  supabase status --workdir $WorkdirRel"
Write-Host "  DB URL: $DbUrl"
Write-Host ""

# ---------------------------------------------------------------------------
# Flag -Proof: esegue la prova S5.
# ---------------------------------------------------------------------------
if ($Proof) {
    Write-Step "Esecuzione prova empirica S5 (proof_s5.sql)..."
    if (-not (Test-Path $ProofSql)) { Fail "proof_s5.sql mancante: $ProofSql" }
    Get-Content -Raw $ProofSql | & docker exec -i $DbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
    if ($LASTEXITCODE -ne 0) { Fail "La prova S5 e fallita (exit $LASTEXITCODE)." }
    Write-Host ""
    Write-Ok "Prova S5 completata (vedi output sopra: LEAK invoices + contrasto notes)."
}

exit 0
