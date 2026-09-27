# Start link.ps1 hidden at every Windows login (a shortcut in your Startup folder), or remove it again.
#   ./scripts/autostart.ps1            enable + start it now
#   ./scripts/autostart.ps1 -Disable   remove
# Log: %LOCALAPPDATA%\LyricDock\link.log
param([switch]$Disable)
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'LyricDock link.lnk'
if ($Disable) { Remove-Item $lnk -ErrorAction SilentlyContinue; Write-Host 'LyricDock link will no longer start at login.'; return }

$shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source ?? (Get-Command powershell).Source
$script = Join-Path $PSScriptRoot 'link.ps1'
$argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $shell; $s.Arguments = $argLine; $s.WorkingDirectory = $PSScriptRoot; $s.WindowStyle = 7; $s.Description = 'LyricDock USB/Wi-Fi link'
$s.Save()
Start-Process $shell -ArgumentList $argLine -WindowStyle Hidden   # one copy only: link.ps1 exits if it's already running
Write-Host "LyricDock link starts at login now (and is running). Log: $env:LOCALAPPDATA\LyricDock\link.log"
