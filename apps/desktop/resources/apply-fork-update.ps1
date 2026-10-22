param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$target = [IO.Path]::GetFullPath([string]$plan.target)
$stage = [IO.Path]::GetFullPath([string]$plan.stage)
$backup = [IO.Path]::GetFullPath([string]$plan.backup)
$failed = [IO.Path]::GetFullPath([string]$plan.failed)
$parent = [IO.Path]::GetDirectoryName($target)
if (!$parent -or $target -eq [IO.Path]::GetPathRoot($target)) { throw 'Invalid application directory' }
foreach ($candidate in @($backup, $failed)) {
  if ([IO.Path]::GetDirectoryName($candidate) -ne $parent -or !$candidate.StartsWith($target + '.', [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup path is outside the application directory parent' }
  if (Test-Path -LiteralPath $candidate) { throw 'Backup destination already exists' }
}
if (!(Test-Path -LiteralPath (Join-Path $stage 'pi-gui.exe'))) { throw 'Staged executable is missing' }
if (!(Test-Path -LiteralPath (Join-Path $target 'pi-gui.exe'))) { throw 'Installed executable is missing' }
$log = Join-Path ([IO.Path]::GetDirectoryName($PlanPath)) 'apply.log'
$movedOld = $false
$movedNew = $false
$newProcess = $null
try {
  # The app has requested a graceful quit; never terminate it to force an upgrade.
  $old = Get-Process -Id ([int]$plan.pid) -ErrorAction SilentlyContinue
  if ($old -and !$old.WaitForExit(120000)) { throw 'The application did not close; update postponed' }
  Move-Item -LiteralPath $target -Destination $backup
  $movedOld = $true
  Move-Item -LiteralPath $stage -Destination $target
  $movedNew = $true
  $env:PI_GUI_UPDATE_HEALTH_FILE = [string]$plan.healthFile
  $env:PI_GUI_UPDATE_HEALTH_TOKEN = [string]$plan.token
  $newProcess = Start-Process -FilePath (Join-Path $target 'pi-gui.exe') -WorkingDirectory $target -WindowStyle Normal -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  $healthy = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $plan.healthFile) {
      $health = Get-Content -LiteralPath $plan.healthFile -Raw | ConvertFrom-Json
      if ($health.token -eq $plan.token -and $health.version -eq $plan.version) { $healthy = $true; break }
    }
    $newProcess.Refresh()
    if ($newProcess.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if (!$healthy) { throw 'New version failed its startup health check' }
  "Updated to $($plan.version). Previous version retained at $backup" | Set-Content -LiteralPath $log
} catch {
  $failure = $_.Exception.Message
  # Only the process launched by this updater may be closed during rollback.
  if ($newProcess) {
    $newProcess.Refresh()
    if (!$newProcess.HasExited) {
      [void]$newProcess.CloseMainWindow()
      if (!$newProcess.WaitForExit(15000)) {
        "Rollback needs manual attention: new process did not close. $failure. Backup: $backup" | Set-Content -LiteralPath $log
        exit 1
      }
    }
  }
  if ($movedNew) { Move-Item -LiteralPath $target -Destination $failed }
  if ($movedOld) { Move-Item -LiteralPath $backup -Destination $target }
  Remove-Item Env:PI_GUI_UPDATE_HEALTH_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:PI_GUI_UPDATE_HEALTH_TOKEN -ErrorAction SilentlyContinue
  if ($movedOld) { Start-Process -FilePath (Join-Path $target 'pi-gui.exe') -WorkingDirectory $target -WindowStyle Normal }
  "Update failed; original application retained/restored. $failure" | Set-Content -LiteralPath $log
  exit 1
}
