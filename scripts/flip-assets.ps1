# Bakes the flip clock's digit images (android/app/src/main/assets/fc-*.webp) from scripts/flip-assets.html, which
# redraws the Figma design (Dumpyard, page "LyricDock · Flip Clock", frame "Digits — Puff 3D") as SVG filters.
# Baked, not live: 24 filtered layers flipping in 3D would be too heavy for the phone's WebView.
# Needs Edge (headless screenshots) and ImageMagick (PNG -> WebP).   ./scripts/flip-assets.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$out = "$root\android\app\src\main\assets"
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'lyricdock-flip'
New-Item -ItemType Directory -Force $tmp | Out-Null
$url = ([uri]"$PSScriptRoot\flip-assets.html").AbsoluteUri
$names = @(0..9 | ForEach-Object { "card-$_"; "numeral-$_" }) + 'card-blank'
foreach ($n in $names) {
  & $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --default-background-color=00000000 `
    --window-size=300,440 "--user-data-dir=$tmp\profile" "--screenshot=$tmp\$n.png" "$url#$n" 2>$null | Out-Null
  magick "$tmp\$n.png" -define webp:alpha-quality=100 -quality 88 (Join-Path $out "fc-$n.webp")
}
Write-Host "wrote $($names.Count) images to $out"
