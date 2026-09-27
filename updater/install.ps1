# LyricDock installer / updater for Windows. Safe to run any time: it installs or repairs, never loses settings.
#   iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex
# Puts the auto-updating LyricDock loader into Spicetify, re-applies Spicetify (needed after Spotify updates
# itself and wipes it), and updates the phone app if one is plugged in with adb.
# Works on Windows PowerShell 5.1 (no ?? / ternaries).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest's own progress bar is slow and draws over our output
$Repo = 'DhakadG/lyricdock'
$Raw = "https://raw.githubusercontent.com/$Repo/main"
$Steps = 6

function Banner {
    Write-Host ''
    Write-Host '    _               _      ___             _    ' -ForegroundColor Green
    Write-Host '   | |  _  _ _ _ __(_)__  |   \ ___  __ __| |__ ' -ForegroundColor Green
    Write-Host '   | |_| || | ''_/ _| / _| | |) / _ \/ _/ _| / / ' -ForegroundColor Green
    Write-Host '   |____\_, |_| \__|_\__| |___/\___/\__\__|_\_\ ' -ForegroundColor Green
    Write-Host '        |__/            lyrics dock for Spotify' -ForegroundColor DarkGray
    Write-Host ''
}
function Section($t) { Write-Host ''; Write-Host "  >> $t" -ForegroundColor Cyan; Write-Host ('  ' + '-' * 50) -ForegroundColor DarkGray }
function Step($n, $t) { Write-Host "     [*] ($n/$Steps) $t" -ForegroundColor White }
function Ok($t) { Write-Host "             $t" -ForegroundColor Green }
function Info($t) { Write-Host "             $t" -ForegroundColor Gray }
function Warn($t) { Write-Host "             $t" -ForegroundColor Yellow }
function Fail($t) {
    Write-Host ''
    Write-Host "  [!] $t" -ForegroundColor Red
    Write-Host ''
    Write-Host '  Press Enter to close.' -ForegroundColor DarkGray
    [void](Read-Host)
    exit 1
}

Banner
Section 'CHECKING REQUIREMENTS'

Step 1 'Checking network connectivity...'
try { $latest = (Invoke-RestMethod "$Raw/extension/version.json?t=$([DateTime]::UtcNow.Ticks)" -TimeoutSec 15).version }
catch { Fail "Can't reach GitHub ($($_.Exception.Message)). Check your connection and run this again." }
if ($latest -notmatch '^\d+\.\d+\.\d+$') { Fail "GitHub returned an unexpected version ('$latest')." }
Ok 'Network connected'

Step 2 'Checking Spicetify installation...'
$spicetify = (Get-Command spicetify -ErrorAction SilentlyContinue).Source
if (-not $spicetify -and (Test-Path "$env:LOCALAPPDATA\spicetify\spicetify.exe")) { $spicetify = "$env:LOCALAPPDATA\spicetify\spicetify.exe" }
if (-not $spicetify) { Fail 'Spicetify is not installed (LyricDock runs inside it). Install it from https://spicetify.app, then run this again.' }
$ext = Join-Path (Split-Path (& $spicetify -c)) 'Extensions'
Ok 'Spicetify found'
Info "Extensions folder: $ext"

Write-Host ''
if (Test-Path (Join-Path $ext 'lyricdock.js')) { Write-Host '                    [ UPDATING ]' -ForegroundColor Magenta }
else { Write-Host '                    [ INSTALLING ]' -ForegroundColor Magenta }
Info "Latest version: $latest"

Step 3 'Checking Spotify process...'
if (Get-Process Spotify -ErrorAction SilentlyContinue) {
    Info 'Spotify is running, closing...'
    Stop-Process -Name Spotify -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Ok 'Spotify closed'
} else { Ok 'Spotify is not running' }

Step 4 'Checking target directory...'
New-Item -ItemType Directory -Force $ext | Out-Null
Ok 'Directory ready'

Section 'DOWNLOADING'
Step 5 'Downloading the LyricDock loader...'
# The loader is the only file Spicetify keeps; it fetches the matching LyricDock build itself (and caches it).
$tmp = Join-Path $env:TEMP 'lyricdock.js'
try { Invoke-WebRequest -UseBasicParsing "https://cdn.jsdelivr.net/gh/$Repo@v$latest/extension/lyricdock.js" -OutFile $tmp }
catch { Invoke-WebRequest -UseBasicParsing "$Raw/extension/lyricdock.js" -OutFile $tmp } # tag not on the CDN yet
if (-not (Select-String -Path $tmp -Pattern 'lyricdockLoader' -Quiet)) { Fail 'The download looks wrong (not the LyricDock loader). Try again in a minute.' }
Copy-Item $tmp (Join-Path $ext 'lyricdock.js') -Force
Remove-Item $tmp -ErrorAction SilentlyContinue
Ok "Loader installed (loads LyricDock v$latest and keeps it updated)"

Section 'CONFIGURING'
Step 6 'Applying Spicetify configuration...'
& $spicetify config extensions 'dock-bridge.js-' 2>&1 | Out-Null # a development copy must not run alongside
& $spicetify config extensions lyricdock.js 2>&1 | Out-Null
Info 'Extension enabled'
$out = & $spicetify apply 2>&1
if ($LASTEXITCODE) {
    Info 'Spotify probably updated and wiped Spicetify - restoring...'
    $out = & $spicetify backup apply 2>&1
}
if ($LASTEXITCODE) { $out | ForEach-Object { Info "$_" }; Fail 'spicetify apply failed (output above).' }
Ok 'Spicetify applied - Spotify is starting'

# Phone app: it updates itself from GitHub Releases (Settings -> Updates). With a phone plugged in over adb,
# install the latest APK now as well.
Section 'PHONE APP'
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
$phone = if ($adb) { (& $adb devices) -match "`tdevice$" | Select-Object -First 1 } else { $null }
if ($phone) {
    try {
        $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 15
        $asset = $rel.assets | Where-Object name -like '*.apk' | Select-Object -First 1
        if (-not $asset) { throw 'no APK on the latest release' }
        $apk = Join-Path $env:TEMP $asset.name
        Info "Downloading $($asset.name)..."
        Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $apk
        Info 'Installing on the phone...'
        & $adb install -r -t $apk 2>&1 | Out-Null
        if ($LASTEXITCODE) { throw 'adb install failed' }
        & $adb shell am start -n com.you.lyricdock/.MainActivity 2>&1 | Out-Null
        Remove-Item $apk -ErrorAction SilentlyContinue
        Ok "Phone updated to $($rel.tag_name)"
    } catch { Warn "Phone not updated: $($_.Exception.Message). It will update itself." }
} else { Info 'No phone on adb - the phone app updates itself (Settings -> Updates).' }

Write-Host ''
Write-Host "  LyricDock $latest is ready. Open the LyricDock button in Spotify's top bar." -ForegroundColor Green
Write-Host ''
Start-Sleep -Seconds 4
