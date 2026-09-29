# Inline the app's scripts + a fake bridge (preview-driver.js) into android/build/preview.html,
# so the page can be opened in any browser at 760x360 (the phone's CSS viewport) without a phone.
$root = Split-Path $PSScriptRoot
$a = "$root\android\app\src\main\assets"
$h = Get-Content "$a\index.html" -Raw
$h = $h.Replace('<link rel="stylesheet" href="style.css">', "<style>`n$(Get-Content "$a\style.css" -Raw)`n</style>")
foreach ($f in "kawarp.js", "roman.js", "settings.js", "api.js", "spotify.js", "rtc.js", "anim.js", "lyrics.js", "app.js", "flipclock.js", "features.js", "swipe.js") {
    $h = $h.Replace("<script src=""$f""></script>", "<script>`n$(Get-Content "$a\$f" -Raw)`n</script>")
}
$h = $h.Replace("</body>", "<script>`n$(Get-Content "$PSScriptRoot\preview-driver.js" -Raw)`n</script>`n</body>")
New-Item -ItemType Directory -Force "$root\android\build" | Out-Null
Set-Content "$root\android\build\preview.html" $h -NoNewline
Write-Host "open $root\android\build\preview.html"
