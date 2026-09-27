# Install (or update) the LyricDock bridge in Spicetify and apply - Spotify restarts. Nothing to configure.
# Run again after a Spotify update if Spicetify was wiped (`spicetify backup apply` if it asks for a backup).
$spicetify = (Get-Command spicetify -ErrorAction SilentlyContinue).Source
if (-not $spicetify) { throw 'Spicetify not found - install it from https://spicetify.app first.' }
$src = Join-Path (Split-Path $PSScriptRoot) 'extension\dock-bridge.js'
$dst = Join-Path (Split-Path (& $spicetify -c)) 'Extensions'
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item $src $dst -Force
& $spicetify config extensions dock-bridge.js 2>&1 | Out-Null   # "already in the list" is fine
& $spicetify apply
if ($LASTEXITCODE) { Write-Host "`nspicetify apply failed. If Spotify just updated, run: spicetify backup apply" -ForegroundColor Yellow }
