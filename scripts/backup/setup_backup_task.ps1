# =============================================================================
# DQMP Backup Setup — Registers the Windows Task Scheduler job
# Run this script ONCE as Administrator to install the daily backup task.
# =============================================================================
# Usage:  Right-click → "Run as Administrator"  OR
#         Start PowerShell as Admin then run:
#         .\setup_backup_task.ps1
# =============================================================================

$TASK_NAME   = "DQMP_PostgreSQL_Daily_Backup"
$SCRIPT_PATH = "$PSScriptRoot\auto_backup_and_sync.ps1"
$BACKUP_ROOT = "C:\backup"
$LOG_FILE    = "$BACKUP_ROOT\sync_log.txt"

# ─── Check for admin privileges ───────────────────────────────────────────────
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host ""
    Write-Host "ERROR: This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click the script and choose 'Run as administrator'." -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  DQMP PostgreSQL Auto-Backup Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ─── Create backup root folder ────────────────────────────────────────────────
if (-not (Test-Path $BACKUP_ROOT)) {
    New-Item -ItemType Directory -Path $BACKUP_ROOT -Force | Out-Null
    Write-Host "[OK] Created backup directory: $BACKUP_ROOT" -ForegroundColor Green
} else {
    Write-Host "[OK] Backup directory already exists: $BACKUP_ROOT" -ForegroundColor Green
}

# ─── Remove existing task if it already exists ────────────────────────────────
$existing = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
    Write-Host "[OK] Removed old task '$TASK_NAME'" -ForegroundColor Yellow
}

# ─── Build the scheduled task ─────────────────────────────────────────────────
# Action: run PowerShell with the backup script, bypass execution policy
$action  = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -NoProfile -ExecutionPolicy Bypass -File `"$SCRIPT_PATH`""

# Trigger: daily at 00:00 (midnight)
$trigger = New-ScheduledTaskTrigger -Daily -At "00:00"

# Principal: run as SYSTEM so it works even when no user is logged in
$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# Settings
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -StartWhenAvailable `       # Run the missed task if the machine was off at midnight
    -MultipleInstances IgnoreNew

# Register
Register-ScheduledTask `
    -TaskName  $TASK_NAME `
    -Action    $action `
    -Trigger   $trigger `
    -Principal $principal `
    -Settings  $settings `
    -Description "Daily automatic backup of DQMP PostgreSQL database (dqmp-central-db)" `
    | Out-Null

Write-Host "[OK] Scheduled task '$TASK_NAME' registered successfully." -ForegroundColor Green
Write-Host ""
Write-Host "  Schedule  : Every day at 00:00 (midnight)" -ForegroundColor White
Write-Host "  Script    : $SCRIPT_PATH" -ForegroundColor White
Write-Host "  Backups   : $BACKUP_ROOT" -ForegroundColor White
Write-Host "  Log file  : $LOG_FILE" -ForegroundColor White
Write-Host ""

# ─── Prompt to run a test backup now ──────────────────────────────────────────
$runNow = Read-Host "Run a test backup RIGHT NOW to verify everything works? (y/n)"
if ($runNow -eq 'y' -or $runNow -eq 'Y') {
    Write-Host ""
    Write-Host "Running test backup..." -ForegroundColor Cyan
    & $SCRIPT_PATH
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[SUCCESS] Test backup completed! Check $BACKUP_ROOT for the backup file." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "[FAILED] Test backup failed. Check $LOG_FILE for details." -ForegroundColor Red
    }
} else {
    Write-Host "Skipped. The first automatic backup will run tonight at midnight." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
pause
