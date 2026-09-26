# Install the LyricDock bridge into Spicetify.
#   ./scripts/install-extension.ps1 -PhoneIp 192.168.1.50   # USB + Wi-Fi fallback
#   ./scripts/install-extension.ps1                          # USB only
param([string]$PhoneIp = '')
if ($PhoneIp -and $PhoneIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "PhoneIp must look like 192.168.1.50" }
$src = Join-Path (Split-Path $PSScriptRoot) 'extension\dock-bridge.js'
$dst = Join-Path (Split-Path (spicetify -c)) 'Extensions\dock-bridge.js'
(Get-Content $src -Raw).Replace('__PHONE_IP__', $PhoneIp) | Set-Content $dst -NoNewline
spicetify config extensions dock-bridge.js
spicetify apply
