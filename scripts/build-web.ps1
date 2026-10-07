# Build the LyricDock web app into web/dist: the phone app's assets plus the web layer (web/public).
#   ./scripts/build-web.ps1            build only
#   ./scripts/build-web.ps1 -Deploy    build, then publish to https://app.lyricdock.losthusky.qzz.io
# index.html gets the manifest/icons and shim.js (before the app scripts) and install.js (after them); the service
# worker gets this version and the full file list. Docs: docs/web-app.md.
param([switch]$Deploy)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$version = (Get-Content "$root\extension\version.json" -Raw | ConvertFrom-Json).version
$dist = "$root\web\dist"

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
Copy-Item "$root\android\app\src\main\assets" $dist -Recurse
Copy-Item "$root\web\public\*" $dist -Recurse -Force

$head = @(
  '<title>LyricDock</title>'
  '<meta name="description" content="Word-synced Spotify lyrics, album art and controls on any screen.">'
  '<link rel="manifest" href="manifest.webmanifest">'
  '<link rel="icon" href="icons/icon.svg" type="image/svg+xml">'
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
  '<meta name="theme-color" content="#000000">'
  '<meta name="mobile-web-app-capable" content="yes">'
  '<meta name="apple-mobile-web-app-capable" content="yes">'
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
  '<link rel="stylesheet" href="web.css">'
  '<script src="shim.js"></script>'
) -join "`n"
$html = Get-Content "$dist\index.html" -Raw
if ($html -notmatch '</head>' -or $html -notmatch '</body>') { throw 'index.html: no </head> / </body>' }
$html = $html.Replace('</head>', "$head`n</head>").Replace('</body>', "<script src=`"install.js`"></script><script src=`"mini.js`"></script>`n</body>")
Set-Content "$dist\index.html" $html -NoNewline

(Get-Content "$dist\shim.js" -Raw).Replace('__VERSION__', $version) | Set-Content "$dist\shim.js" -NoNewline
# The service worker's cache is named by version + a hash of every file, so any redeploy (even of the same version)
# reaches open tabs and installed apps.
$sha = [System.Security.Cryptography.SHA256]::Create()
$all = [IO.MemoryStream]::new() # every file's bytes in order (piping them as [byte[]] went byte by byte: minutes)
Get-ChildItem $dist -Recurse -File | Where-Object Name -ne 'sw.js' | Sort-Object FullName | ForEach-Object { $b = [IO.File]::ReadAllBytes($_.FullName); $all.Write($b, 0, $b.Length) }
$hash = -join ($sha.ComputeHash($all.ToArray()) | Select-Object -First 4 | ForEach-Object { $_.ToString('x2') })
(Get-Content "$dist\sw.js" -Raw).Replace('__VERSION__', "$version-$hash") | Set-Content "$dist\sw.js" -NoNewline
$files = Get-ChildItem $dist -Recurse -File | Where-Object { $_.Name -notin 'sw.js', '_headers' } |
  ForEach-Object { $_.FullName.Substring($dist.Length + 1).Replace('\', '/') } |
  ForEach-Object { if ($_ -eq 'index.html') { './' } else { $_ } } | Sort-Object # the page is cached as / (see sw.js)
(Get-Content "$dist\sw.js" -Raw).Replace('__FILES__', ($files | ConvertTo-Json -Compress)) | Set-Content "$dist\sw.js" -NoNewline

$mb = [math]::Round((Get-ChildItem $dist -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "web app v$version built: $($files.Count) files, $mb MB -> $dist"

if ($Deploy) {
  Push-Location "$root\web"
  try { npx wrangler deploy; if ($LASTEXITCODE) { throw 'wrangler deploy failed' } } finally { Pop-Location }
}
