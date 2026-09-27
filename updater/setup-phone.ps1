# LyricDock one-time phone setup from a Windows PC, over a USB cable. Run once per phone:
#   iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/setup-phone.ps1 | iex
# Installs the LyricDock app and (optionally) makes it the phone's kiosk app: full screen, starts on boot,
# updates itself silently. It needs Android's adb for these few minutes only: adb is downloaded into a temp
# folder and deleted again at the end (an adb you already have is used and left alone). Nothing stays running,
# and USB debugging can be switched off afterwards - LyricDock itself never uses adb.
# Works on Windows PowerShell 5.1 (no ?? / ternaries).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'DhakadG/lyricdock'; $Pkg = 'com.you.lyricdock'
$Steps = 6

function Section($t) { Write-Host ''; Write-Host "  >> $t" -ForegroundColor Cyan; Write-Host ('  ' + '-' * 50) -ForegroundColor DarkGray }
function Step($n, $t) { Write-Host "     [*] ($n/$Steps) $t" -ForegroundColor White }
function Ok($t) { Write-Host "             $t" -ForegroundColor Green }
function Info($t) { Write-Host "             $t" -ForegroundColor Gray }
function Warn($t) { Write-Host "             $t" -ForegroundColor Yellow }
$script:TempTools = $null
function Cleanup {
    if ($script:TempTools) {
        & $script:Adb kill-server 2>&1 | Out-Null
        Start-Sleep -Milliseconds 500
        Remove-Item $script:TempTools -Recurse -Force -ErrorAction SilentlyContinue
    }
}
function Fail($t) {
    Write-Host ''
    Write-Host "  [!] $t" -ForegroundColor Red
    Cleanup
    Write-Host ''
    Write-Host '  Press Enter to close.' -ForegroundColor DarkGray
    [void](Read-Host)
    exit 1
}

Write-Host ''
Write-Host '   LyricDock - phone setup (one time)' -ForegroundColor Green
Write-Host ''
Write-Host '   Before you start, on the phone:' -ForegroundColor White
Write-Host '     1. Settings > About phone > Software information > tap "Build number" 7 times (Developer options on)'
Write-Host '     2. Settings > Developer options > turn on "USB debugging"'
Write-Host '     3. Connect the phone to this PC with a USB data cable'
Write-Host '   For kiosk mode (recommended for a dedicated dock) the phone must have no accounts signed in'
Write-Host '   (Settings > Accounts): Android only allows a kiosk app on a phone without accounts.' -ForegroundColor DarkGray
Write-Host ''
[void](Read-Host '   Press Enter when the phone is connected')

Section 'PREPARING'
Step 1 'Getting adb (temporary)...'
$script:Adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if ($script:Adb) { Ok "Using your adb: $script:Adb" }
else {
    $script:TempTools = Join-Path $env:TEMP "lyricdock-setup-$([guid]::NewGuid().ToString('n').Substring(0, 8))"
    try {
        Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile "$script:TempTools.zip"
        Expand-Archive "$script:TempTools.zip" $script:TempTools -Force
        Remove-Item "$script:TempTools.zip"
    } catch { Fail "Couldn't download Android platform-tools from Google: $($_.Exception.Message)" }
    $script:Adb = Join-Path $script:TempTools 'platform-tools\adb.exe'
    Ok 'Downloaded (deleted again when setup finishes)'
}

Step 2 'Waiting for the phone...'
$said = $false; $serial = $null
for ($i = 0; $i -lt 120 -and -not $serial; $i++) {
    $rows = @(& $script:Adb devices 2>$null) | Where-Object { $_ -match '^\S+\s+(device|unauthorized)$' }
    $ready = $rows | Where-Object { $_ -match '\sdevice$' } | Select-Object -First 1
    if ($ready) { $serial = ($ready -split '\s+')[0]; break }
    if ($rows -and -not $said) { Warn 'On the phone: tap "Allow" on the USB debugging prompt (tick "Always allow")'; $said = $true }
    Start-Sleep -Seconds 1
}
if (-not $serial) { Fail 'No phone found. Check the cable (a data cable, not charge-only) and that USB debugging is on, then run this again.' }
$model = (& $script:Adb -s $serial shell getprop ro.product.model) -join ''
Ok "Found $model"

Section 'INSTALLING'
Step 3 'Downloading the latest LyricDock app...'
try {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 20
    $asset = $rel.assets | Where-Object name -like '*.apk' | Select-Object -First 1
    if (-not $asset) { throw 'the latest release has no APK' }
    $apk = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $apk
} catch { Fail "Couldn't download the app: $($_.Exception.Message)" }
Ok "$($rel.tag_name) downloaded"

Step 4 'Installing on the phone...'
$out = & $script:Adb -s $serial install -r -t $apk 2>&1
Remove-Item $apk -ErrorAction SilentlyContinue
if ($LASTEXITCODE) { Fail "Install failed: $($out -join ' ')" }
Ok 'Installed'

Section 'CONFIGURING'
Step 5 'Kiosk mode (full screen, starts on boot, silent updates)...'
$owner = (& $script:Adb -s $serial shell dpm list-owners 2>$null) -join ' '
if ($owner -match $Pkg) { Ok 'Already on' }
else {
    $a = Read-Host '             Turn on kiosk mode? [Y/n]'
    if ($a -match '^n') { Info 'Skipped - LyricDock runs as a normal app (updates ask before installing).' }
    else {
        $out = (& $script:Adb -s $serial shell dpm set-device-owner "$Pkg/.AdminReceiver" 2>&1) -join ' '
        if ($out -match 'Success') { Ok 'Kiosk mode on' }
        elseif ($out -match 'accounts') { Warn 'Not possible while accounts are signed in on the phone (Settings > Accounts).'; Warn 'Remove them, then run this again - or keep using LyricDock as a normal app.' }
        else { Warn "Kiosk mode not turned on: $out" }
    }
}

Step 6 'Starting LyricDock...'
& $script:Adb -s $serial shell am start -n "$Pkg/.MainActivity" 2>&1 | Out-Null
Ok 'Started'
Cleanup
if ($script:TempTools) { Info 'Temporary adb removed' }

Write-Host ''
Write-Host '  Done. Next:' -ForegroundColor Green
Write-Host '    - USB debugging can be switched off now (Settings > Developer options); LyricDock does not need it.'
Write-Host '    - On the PC, if not done yet:  iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex'
Write-Host '    - Pair: the phone shows a code (like K7QX-9MP-2F2). In Spotify on the PC click the LyricDock button in'
Write-Host '      the top bar, type the code under "Pair phone" and click Pair. Once per phone - it reconnects by itself.'
Write-Host '      (If the phone is signed in to your Spotify account - Settings > Playback source - Spotify finds it'
Write-Host '      without the code: just tap Allow on the phone when both show the same 4 digits.)'
Write-Host ''
[void](Read-Host '  Press Enter to close')
