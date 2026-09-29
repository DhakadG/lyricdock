# Tell every open LyricDock to check for an update now and install it (even with "Update automatically" off).
#   ./scripts/ping-update.ps1            (release.ps1 runs this after publishing)
# Instant path: ntfy.sh (see "Update ping" in android/app/src/main/assets/app.js). If ntfy refuses (down, or its free
# daily quota), nothing is lost: docks also read extension/version.json on GitHub every 5 minutes and install from that.
try {
    Invoke-RestMethod -Method Post -Uri 'https://ntfy.sh/lyricdock-update-ping-v1' -Body 'update' -TimeoutSec 15 | Out-Null
    Write-Host 'Update ping sent - open docks check GitHub now.'
} catch {
    Write-Warning "ntfy.sh did not take the ping ($($_.Exception.Message.Split("`n")[0])). Open docks still update within ~5-10 min from version.json."
}
