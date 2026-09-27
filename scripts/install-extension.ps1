# Install LyricDock into Spicetify and apply (Spotify restarts). Nothing to configure.
#   ./scripts/install-extension.ps1        the auto-updating loader (lyricdock.js): always runs the latest release
#   ./scripts/install-extension.ps1 -Dev   this checkout's extension/dock-bridge.js directly (no auto-updates)
# Run again after a Spotify update if Spicetify was wiped (`spicetify backup apply` if it asks for a backup).
param([switch]$Dev)
$spicetify = (Get-Command spicetify -ErrorAction SilentlyContinue).Source
if (-not $spicetify) { throw 'Spicetify not found - install it from https://spicetify.app first.' }
$ext = Join-Path (Split-Path $PSScriptRoot) 'extension'
$dst = Join-Path (Split-Path (& $spicetify -c)) 'Extensions'
New-Item -ItemType Directory -Force $dst | Out-Null
$use, $drop = if ($Dev) { 'dock-bridge.js', 'lyricdock.js' } else { 'lyricdock.js', 'dock-bridge.js' }
Copy-Item (Join-Path $ext $use) $dst -Force
& $spicetify config extensions "$drop-" 2>&1 | Out-Null   # only one of the two may be enabled
& $spicetify config extensions $use 2>&1 | Out-Null
& $spicetify apply
if ($LASTEXITCODE) { Write-Host "`nspicetify apply failed. If Spotify just updated, run: spicetify backup apply" -ForegroundColor Yellow }
else { Write-Host "`nLyricDock installed ($(if ($Dev) { 'development build' } else { 'auto-updating' }))." }
