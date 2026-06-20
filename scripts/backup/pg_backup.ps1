# =============================================================================
# DQMP PostgreSQL Auto-Backup Script
# =============================================================================
# Runs pg_dump daily and saves compressed backups to the backup folder.
# Old backups older than RETENTION_DAYS are automatically deleted.
# =============================================================================

# ─── Configuration ────────────────────────────────────────────────────────────
$PG_HOST        = "localhost"
$PG_PORT        = "5432"
$PG_DB          = "dqmp-central-db"
$PG_USER        = "postgres"
$PG_PASSWORD    = "ojitha2026"

# Path to pg_dump (pgAdmin bundles its own copy)
$PG_DUMP        = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"

# Where backups will be stored
$BACKUP_ROOT    = "C:\DQMP_Backups"

# How many days to keep backups (older ones are deleted automatically)
$RETENTION_DAYS = 30

# ─── Derived values ───────────────────────────────────────────────────────────
$TIMESTAMP      = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$BACKUP_DIR     = Join-Path $BACKUP_ROOT (Get-Date -Format "yyyy\MM")   # e.g. C:\DQMP_Backups\2026\06
$BACKUP_FILE    = Join-Path $BACKUP_DIR "dqmp_backup_$TIMESTAMP.sql"
$LOG_FILE       = Join-Path $BACKUP_ROOT "backup_log.txt"

# ─── Ensure backup root exists before any logging ────────────────────────────
if (-not (Test-Path $BACKUP_ROOT)) {
    New-Item -ItemType Directory -Path $BACKUP_ROOT -Force | Out-Null
}

# ─── Helper: Write timestamped log line ───────────────────────────────────────
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Message"
    Add-Content -Path $LOG_FILE -Value $line
    Write-Host $line
}

# ─── Main ─────────────────────────────────────────────────────────────────────
Write-Log "========== DQMP Backup Started =========="

# 1. Ensure backup directory exists
if (-not (Test-Path $BACKUP_DIR)) {
    New-Item -ItemType Directory -Path $BACKUP_DIR -Force | Out-Null
    Write-Log "Created backup directory: $BACKUP_DIR"
}

# 2. Set PGPASSWORD so pg_dump doesn't prompt
$env:PGPASSWORD = $PG_PASSWORD

# 3. Run pg_dump — plain SQL format (easy to inspect / restore)
Write-Log "Running pg_dump for database '$PG_DB'..."

# Build argument string (cmd /c handles spaces in path correctly on this system)
$pgDumpArgStr = "--host=$PG_HOST --port=$PG_PORT --username=$PG_USER --dbname=`"$PG_DB`" --format=plain --no-password --file=`"$BACKUP_FILE`""
$cmdLine = "`"$PG_DUMP`" $pgDumpArgStr"

$proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c `"$cmdLine`"" `
    -NoNewWindow -Wait -PassThru
$pgDumpExit = $proc.ExitCode

# Clear password from environment immediately after use
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($pgDumpExit -ne 0) {
    Write-Log "pg_dump FAILED with exit code $pgDumpExit. Backup aborted." "ERROR"
    exit 1
}

Write-Log "pg_dump completed successfully: $BACKUP_FILE"

# 4. Compress the .sql file into a .zip archive to save disk space
$ZIP_FILE = "$BACKUP_FILE.zip"
Write-Log "Compressing backup to: $ZIP_FILE"
try {
    Compress-Archive -Path $BACKUP_FILE -DestinationPath $ZIP_FILE -CompressionLevel Optimal
    Remove-Item $BACKUP_FILE -Force          # delete the uncompressed .sql
    Write-Log "Compression done. Zip size: $([math]::Round((Get-Item $ZIP_FILE).Length / 1MB, 2)) MB"
} catch {
    Write-Log "Compression failed: $_  (keeping uncompressed .sql)" "WARN"
}

# 5. Prune backups older than RETENTION_DAYS
Write-Log "Pruning backups older than $RETENTION_DAYS days..."
$cutoff = (Get-Date).AddDays(-$RETENTION_DAYS)
$deleted = 0
Get-ChildItem -Path $BACKUP_ROOT -Recurse -Include "*.zip","*.sql" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Remove-Item $_.FullName -Force
        Write-Log "  Deleted old backup: $($_.FullName)"
        $deleted++
    }

if ($deleted -eq 0) {
    Write-Log "No old backups to prune."
} else {
    Write-Log "Pruned $deleted old backup file(s)."
}

# 6. Summary
$allBackups = Get-ChildItem -Path $BACKUP_ROOT -Recurse -Include "*.zip","*.sql" | Measure-Object -Property Length -Sum
$totalMB    = [math]::Round($allBackups.Sum / 1MB, 2)
Write-Log "Current backup storage: $($allBackups.Count) file(s), $totalMB MB total"
Write-Log "========== DQMP Backup Completed Successfully =========="
