# Install the LyricDock bridge into Spicetify. The phone's Wi-Fi IP is learned automatically (or set it from
# Spotify's profile menu -> LyricDock), so there is nothing to configure here.
$src = Join-Path (Split-Path $PSScriptRoot) 'extension\dock-bridge.js'
$dst = Join-Path (Split-Path (spicetify -c)) 'Extensions'
Copy-Item $src $dst -Force
spicetify config extensions dock-bridge.js
spicetify apply
