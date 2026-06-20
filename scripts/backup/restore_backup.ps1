# =============================================================================
# DQMP Backup — Manual Restore Helper
# =============================================================================
# Use this script to restore a backup file into PostgreSQL.
# Run as Administrator.
# =============================================================================
# Usage:
#   .\restore_backup.ps1 -BackupFile "C:\DQMP_Backups\2026\06\dqmp_backup_2026-06-14_00-00-00.sql.zip"
#
# Or run without arguments to pick from a list of available backups.
# =============================================================================
param(
    [string]$BackupFile = ""
)

$PG_HOST     = "localhost"
$PG_PORT     = "5432"
$PG_DB       = "dqmp-central-db"
$PG_USER     = "postgres"
$PG_PASSWORD = "ojitha2026"
$PSQL        = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$BACKUP_ROOT = "C:\DQMP_Backups"
$TEMP_DIR    = "$env:TEMP\dqmp_restore_temp"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  DQMP PostgreSQL Restore Helper" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ─── Pick backup file if not provided ─────────────────────────────────────────
if (-not $BackupFile) {
    $backups = Get-ChildItem -Path $BACKUP_ROOT -Recurse -Include "*.zip","*.sql" | Sort-Object LastWriteTime -Descending
    if ($backups.Count -eq 0) {
        Write-Host "No backup files found in $BACKUP_ROOT" -ForegroundColor Red
        exit 1
    }
    Write-Host "Available backups (newest first):" -ForegroundColor Yellow
    for ($i = 0; $i -lt [math]::Min($backups.Count, 20); $i++) {
        $b = $backups[$i]
        $sizeMB = [math]::Round($b.Length / 1MB, 2)
        Write-Host "  [$($i+1)] $($b.Name)  ($sizeMB MB)  —  $($b.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
    }
    Write-Host ""
    $choice = Read-Host "Enter number to restore (or Q to quit)"
    if ($choice -eq 'Q' -or $choice -eq 'q') { exit 0 }
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge $backups.Count) {
        Write-Host "Invalid choice." -ForegroundColor Red
        exit 1
    }
    $BackupFile = $backups[$idx].FullName
}

if (-not (Test-Path $BackupFile)) {
    Write-Host "File not found: $BackupFile" -ForegroundColor Red
    exit 1
}

Write-Host "Selected: $BackupFile" -ForegroundColor White
Write-Host ""
Write-Host "WARNING: This will DROP and re-create all data in '$PG_DB'!" -ForegroundColor Red
$confirm = Read-Host "Type 'yes' to proceed, anything else to cancel"
if ($confirm -ne 'yes') {
    Write-Host "Restore cancelled." -ForegroundColor Yellow
    exit 0
}

# ─── Extract zip if needed ────────────────────────────────────────────────────
$sqlFile = $BackupFile
if ($BackupFile.EndsWith(".zip")) {
    Write-Host "Extracting zip archive..."
    if (Test-Path $TEMP_DIR) { Remove-Item $TEMP_DIR -Recurse -Force }
    Expand-Archive -Path $BackupFile -DestinationPath $TEMP_DIR
    $sqlFile = Get-ChildItem -Path $TEMP_DIR -Filter "*.sql" | Select-Object -First 1 -ExpandProperty FullName
    if (-not $sqlFile) {
        Write-Host "Could not find .sql file inside zip." -ForegroundColor Red
        exit 1
    }
    Write-Host "Extracted: $sqlFile"
}

# ─── Restore ──────────────────────────────────────────────────────────────────
$env:PGPASSWORD = $PG_PASSWORD
Write-Host ""
Write-Host "Restoring database '$PG_DB'..." -ForegroundColor Cyan

& $PSQL `
    --host=$PG_HOST `
    --port=$PG_PORT `
    --username=$PG_USER `
    --dbname=postgres `
    --no-password `
    --command="DROP DATABASE IF EXISTS `"$PG_DB`";" 2>&1

& $PSQL `
    --host=$PG_HOST `
    --port=$PG_PORT `
    --username=$PG_USER `
    --dbname=postgres `
    --no-password `
    --command="CREATE DATABASE `"$PG_DB`";" 2>&1

& $PSQL `
    --host=$PG_HOST `
    --port=$PG_PORT `
    --username=$PG_USER `
    --dbname=$PG_DB `
    --no-password `
    --file="$sqlFile" 2>&1

$exitCode = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

# ─── Clean up temp ────────────────────────────────────────────────────────────
if (Test-Path $TEMP_DIR) { Remove-Item $TEMP_DIR -Recurse -Force }

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "[SUCCESS] Database restored successfully from: $BackupFile" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[FAILED] Restore exited with code $exitCode. Check output above." -ForegroundColor Red
}
Write-Host ""
pause
