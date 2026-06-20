# =============================================================================
# DQMP Auto Backup and Sync to Neon
# =============================================================================
# This script is called by Windows Task Scheduler daily.
# It runs the Node.js sync_to_neon.ts script to extract the local database,
# save it to C:\backup, and upload it to the Neon cloud backend.
# =============================================================================

$BACKUP_ROOT = "C:\backup"
$LOG_FILE    = "$BACKUP_ROOT\sync_log.txt"

# ─── Ensure backup root exists ───────────────────────────────────────────────
if (-not (Test-Path $BACKUP_ROOT)) {
    New-Item -ItemType Directory -Path $BACKUP_ROOT -Force | Out-Null
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Message"
    Add-Content -Path $LOG_FILE -Value $line
    Write-Host $line
}

Write-Log "========== DQMP Auto-Sync Started =========="

# Navigate to backend directory
$BACKEND_DIR = "C:\Users\Ojitha Rajapaksha\Desktop\DQMP\backend"
if (-not (Test-Path $BACKEND_DIR)) {
    Write-Log "ERROR: Backend directory not found at $BACKEND_DIR" "ERROR"
    exit 1
}

Set-Location $BACKEND_DIR

# Run the TypeScript sync script
Write-Log "Running Node.js sync script..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"npx tsx scripts\backup\sync_to_neon.ts 2>&1`"" -NoNewWindow -Wait -PassThru
$exitCode = $proc.ExitCode

if ($exitCode -ne 0) {
    Write-Log "Sync script FAILED with exit code $exitCode." "ERROR"
    exit 1
}

Write-Log "========== DQMP Auto-Sync Completed Successfully =========="
