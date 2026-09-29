# Dev tool: tile the screen-audit screenshots into contact sheets (3 states per row) for a quick visual pass.
#   ./scripts/contact-sheet.ps1 [dir]   -> <dir>/sheet-1.png, sheet-2.png ...
param([string]$Dir = "$(Split-Path $PSScriptRoot)\android\build\audit")
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem $Dir -Filter *.png | Where-Object { $_.Name -notmatch '^sheet-\d' } | Sort-Object Name
$first = [System.Drawing.Image]::FromFile($files[0].FullName); $portrait = $first.Height -gt $first.Width; $first.Dispose()
$tw = if ($portrait) { 380 } else { 760 }; $th = if ($portrait) { 800 } else { 360 }; $cols = if ($portrait) { 6 } else { 3 }; $rows = 2; $pad = 30
$font = New-Object System.Drawing.Font 'Segoe UI', 16, ([System.Drawing.FontStyle]::Bold)
$n = 0
for ($s = 0; $s -lt $files.Count; $s += $cols * $rows) {
  $n++
  $bmp = New-Object System.Drawing.Bitmap ($cols * $tw), ($rows * ($th + $pad))
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::FromArgb(20, 20, 24))
  $g.InterpolationMode = 'HighQualityBicubic'
  for ($i = 0; $i -lt $cols * $rows -and $s + $i -lt $files.Count; $i++) {
    $f = $files[$s + $i]; $img = [System.Drawing.Image]::FromFile($f.FullName)
    $x = ($i % $cols) * $tw; $y = [math]::Floor($i / $cols) * ($th + $pad)
    $g.DrawString($f.BaseName, $font, [System.Drawing.Brushes]::White, $x + 6, $y + 2)
    $g.DrawImage($img, $x, $y + $pad, $tw - 6, $th - 4); $img.Dispose()
  }
  $bmp.Save("$Dir\sheet-$n.png"); $g.Dispose(); $bmp.Dispose()
}
"$n sheets in $Dir"
