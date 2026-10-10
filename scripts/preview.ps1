# Inline the app's scripts + a fake bridge (preview-driver.js) into android/build/preview.html,
# so the page can be opened in any browser at 760x360 (the phone's CSS viewport) without a phone.
$root = Split-Path $PSScriptRoot
$a = "$root\android\app\src\main\assets"
$h = Get-Content "$a\index.html" -Raw
$h = $h.Replace('<link rel="stylesheet" href="style.css">', "<style>`n$(Get-Content "$a\style.css" -Raw)`n</style>")
# every <script src> the page loads, in its order (a hand-kept list here went stale and broke the preview)
foreach ($m in [regex]::Matches($h, '<script src="([\w.-]+)"></script>')) {
    $h = $h.Replace($m.Value, "<script>`n$(Get-Content "$a\$($m.Groups[1].Value)" -Raw)`n</script>")
}
$h = $h.Replace("</body>", "<script>`n$(Get-Content "$PSScriptRoot\preview-driver.js" -Raw)`n</script>`n</body>")
New-Item -ItemType Directory -Force "$root\android\build" | Out-Null
Set-Content "$root\android\build\preview.html" $h -NoNewline
Write-Host "open $root\android\build\preview.html"
