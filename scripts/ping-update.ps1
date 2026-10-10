# Tell every open LyricDock to check for an update now and install it (even with "Update automatically" off).
#   ./scripts/ping-update.ps1            (release.ps1 runs this after publishing)
# Instant path: the self-hosted ntfy, docs/ntfy.md (see "Update ping" in android/app/src/main/assets/app.js). If ntfy refuses,
# nothing is lost: docks also read extension/version.json on GitHub every 5 minutes and install from that.
# Publishing is owner-only (ntfy/src PUBLISH_TOKEN): $env:LYRICDOCK_PUBLISH_TOKEN, or the gitignored secrets/PUBLISH_TOKEN.txt.
$file = Join-Path (Split-Path $PSScriptRoot) 'secrets\PUBLISH_TOKEN.txt'
$token = if ($env:LYRICDOCK_PUBLISH_TOKEN) { $env:LYRICDOCK_PUBLISH_TOKEN } elseif (Test-Path $file) { (Get-Content $file -Raw).Trim() }
if (-not $token) { Write-Warning 'No ntfy publish token (secrets/PUBLISH_TOKEN.txt): skipped the ping. Open docks update within ~5-10 min from version.json.'; return }
try {
    Invoke-RestMethod -Method Post -Uri 'https://ntfy.losthusky.qzz.io/lyricdock-update-ping-v1' -Body 'update' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 15 | Out-Null
    Write-Host 'Update ping sent - open docks check GitHub now.'
} catch {
    Write-Warning "ntfy did not take the ping ($($_.Exception.Message.Split("`n")[0])). Open docks still update within ~5-10 min from version.json."
}
