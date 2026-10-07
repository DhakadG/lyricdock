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
# Downloads: every source is tried with PowerShell, then with curl.exe (built into Windows 10+; it doesn't share
# PowerShell 5.1's slow first connect, proxy auto-detect or old TLS defaults), then the next mirror; two rounds.
# A fresh PC has none of the things LyricDock needs, so nothing here may depend on a single host answering once.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$script:Curl = (Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
function Get-Url([string[]]$Urls, [string]$OutFile) {
    $last = 'no source'
    for ($round = 1; $round -le 2; $round++) {
        foreach ($u in $Urls) {
            try {
                if ($OutFile) { Invoke-WebRequest -UseBasicParsing $u -OutFile $OutFile -TimeoutSec 300; return }
                return [string](Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 60).Content
            } catch { $last = "$u - $($_.Exception.Message)" }
            if ($script:Curl) {
                $to = $OutFile; if (-not $to) { $to = [IO.Path]::GetTempFileName() }
                $ErrorActionPreference = 'Continue'
                & $script:Curl -fsSL --connect-timeout 30 --max-time 600 -o $to $u 2>&1 | Out-Null
                $code = $LASTEXITCODE; $ErrorActionPreference = 'Stop'
                if ($code -eq 0) { if ($OutFile) { return }; $c = [IO.File]::ReadAllText($to); Remove-Item $to; return $c }
                if (-not $OutFile) { Remove-Item $to -ErrorAction SilentlyContinue }
                $last = "$u - curl exit $code"
            }
        }
        if ($round -eq 1) { Start-Sleep -Seconds 3 }
    }
    throw $last
}
# The newest release tag of a GitHub repo: the API (rate-limited per IP), else where /releases/latest redirects to.
function Get-LatestTag([string]$Repo) {
    try { return (Get-Url @("https://api.github.com/repos/$Repo/releases/latest") | ConvertFrom-Json).tag_name } catch {}
    $u = ''
    try { $r = Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/releases/latest" -TimeoutSec 60; $u = "$($r.BaseResponse.ResponseUri)$($r.BaseResponse.RequestMessage.RequestUri)" } catch {}
    if (-not $u -and $script:Curl) { $ErrorActionPreference = 'Continue'; $u = & $script:Curl -fsSL -o NUL -w '%{url_effective}' "https://github.com/$Repo/releases/latest" 2>$null; $ErrorActionPreference = 'Stop' }
    if ("$u" -match '/releases/tag/([^/?#]+)') { return $Matches[1] }
    throw "can't find the latest $Repo release"
}
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
        Get-Url @('https://dl.google.com/android/repository/platform-tools-latest-windows.zip') "$script:TempTools.zip"
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
# Every release attaches lyricdock-vX.Y.Z.apk, so the tag is all we need (API, or the /releases/latest redirect).
try {
    $tag = Get-LatestTag $Repo
    $apk = Join-Path $env:TEMP "lyricdock-$tag.apk"
    Get-Url @("https://github.com/$Repo/releases/download/$tag/lyricdock-$tag.apk") $apk
} catch { Fail "Couldn't download the app: $($_.Exception.Message)" }
Ok "$tag downloaded"

Step 4 'Installing on the phone...'
$out = (& $script:Adb -s $serial install -r -t $apk 2>&1) -join ' '
if ($out -match 'INSTALL_FAILED_VERSION_DOWNGRADE') { Ok 'A newer LyricDock is already installed - kept'; $out = 'Success' }
elseif ($out -match 'UPDATE_INCOMPATIBLE|signatures do not match') {
    # An APK from another build (a developer copy, an old test version): it can't be updated, only replaced.
    Warn 'The LyricDock already on the phone comes from a different build and cannot be updated in place.'
    $a = Read-Host '             Remove it and install the official one? Its settings and pairing are reset [Y/n]'
    if ($a -match '^[nN]') { Remove-Item $apk -ErrorAction SilentlyContinue; Fail 'Left the existing app alone.' }
    $gone = (& $script:Adb -s $serial uninstall $Pkg 2>&1) -join ' '
    # A kiosk (device-owner) app can't be removed from outside: the old app's Settings > Kiosk mode > Leave first.
    if ($gone -notmatch 'Success') { Remove-Item $apk -ErrorAction SilentlyContinue; Fail "Couldn't remove it ($gone). If it runs in kiosk mode: on the phone open its Settings > Kiosk mode > Leave, then run this again." }
    $out = (& $script:Adb -s $serial install -t $apk 2>&1) -join ' '
}
Remove-Item $apk -ErrorAction SilentlyContinue
if ($out -notmatch 'Success') { Fail "Install failed: $out" }
Ok 'Installed'
# What the app would otherwise ask for one by one: notifications (Android 13+: the lock-screen player), reopening
# itself after an update or a crash, and not being put to sleep by battery optimisation.
& $script:Adb -s $serial shell pm grant $Pkg android.permission.POST_NOTIFICATIONS 2>&1 | Out-Null
& $script:Adb -s $serial shell appops set $Pkg SYSTEM_ALERT_WINDOW allow 2>&1 | Out-Null
& $script:Adb -s $serial shell dumpsys deviceidle whitelist +$Pkg 2>&1 | Out-Null
Ok 'Permissions set (notifications, reopen after updates, no battery sleep)'

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
Write-Host '    - On the phone: sign in to LyricDock when it asks (your browser opens once).'
Write-Host '    - Pair: in Spotify on the PC click the LyricDock button in the top bar > Devices > Find devices > Connect.'
Write-Host '      Both screens show the same 6 digits: tap Allow on the phone and Same digits in Spotify.'
Write-Host '      (Or type the code the phone shows, like K7QX-9MP-2F2, under "Pair phone".) Once per phone.'
Write-Host ''
[void](Read-Host '  Press Enter to close')
