# LyricDock installer / updater for Windows (the Spotify side). Safe to run any time: installs or repairs.
#   iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.ps1 | iex
# Puts the auto-updating LyricDock loader into Spicetify, re-applies Spicetify (needed after Spotify updates
# itself and wipes it) and registers lyricdock-updater:// (the Update button in Spotify opens it).
# No adb: the phone is set up once (updater/setup-phone.ps1 or the APK) and then updates itself.
# Works on Windows PowerShell 5.1 (no ?? / ternaries).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest's own progress bar is slow and draws over our output
$Repo = 'DhakadG/lyricdock'
$Raw = "https://raw.githubusercontent.com/$Repo/main"
$Self = "$Raw/updater/install.ps1"
$Steps = 7

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
# Spicetify prints progress on stderr; with 'Stop' + 2>&1, Windows PowerShell 5.1 turns that into a terminating
# NativeCommandError. Run it with errors as plain text and keep the exit code.
function Spice {
    $ErrorActionPreference = 'Continue'
    $extra = @(); if ($script:Admin) { $extra = @('--bypass-admin') } # Spicetify refuses an admin window otherwise
    $o = '' | & $script:spicetify @args @extra 2>&1 | ForEach-Object { "$_" }
    $script:SpiceCode = $LASTEXITCODE
    $o
}
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
$script:Admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
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
# GitHub first; jsDelivr's copy of main as the fallback (it can lag a few hours behind, which is fine for an install).
try { $latest = (Get-Url @("$Raw/extension/version.json?t=$([DateTime]::UtcNow.Ticks)", "https://cdn.jsdelivr.net/gh/$Repo@main/extension/version.json") | ConvertFrom-Json).version }
catch { Fail "Can't reach GitHub or jsDelivr ($($_.Exception.Message)). Check your internet connection and run this again." }
if ($latest -notmatch '^\d+\.\d+\.\d+$') { Fail "GitHub returned an unexpected version ('$latest')." }
Ok 'Network connected'

Step 2 'Checking Spicetify installation...'
# Spotify must be the regular desktop app in %APPDATA%\Spotify. Microsoft Store Spotify (half supported by
# Spicetify, and its folder changes with every Store update) is swapped for it; no Spotify at all -> installed.
$desk = "$env:APPDATA\Spotify"
function Install-SpotifyDesktop {
    # Spotify's installer refuses to run as administrator (it installs per user).
    if ($script:Admin) { Fail 'Spotify cannot be installed from an administrator window. Open a normal PowerShell (not "Run as administrator") and run this again.' }
    Info 'Downloading Spotify from spotify.com...'
    $setup = Join-Path $env:TEMP 'SpotifySetup.exe'
    try { Get-Url @('https://download.scdn.co/SpotifySetup.exe') $setup; Start-Process $setup '/silent' -Wait } catch { Warn "Download failed ($($_.Exception.Message))" }
    Remove-Item $setup -ErrorAction SilentlyContinue
    # Fallback: winget (Windows 10 1809+ / 11), the same per-user desktop app.
    if (-not (Test-Path "$desk\Spotify.exe") -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        Info 'Trying winget...'
        $ErrorActionPreference = 'Continue'
        winget install --id Spotify.Spotify -e --scope user --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Null
        $ErrorActionPreference = 'Stop'
    }
    if (-not (Test-Path "$desk\Spotify.exe")) { Fail 'Spotify did not install. Install it from https://www.spotify.com/download, then run this again.' }
    if (-not (Get-Process Spotify -ErrorAction SilentlyContinue)) { Start-Process "$desk\Spotify.exe" }
    Ok 'Spotify installed'
    Write-Host ''
    Write-Host '  Sign in to Spotify in the window that just opened, then come back here and press Enter.' -ForegroundColor Yellow
    [void](Read-Host)
}
$appx = $null
try { $appx = Get-AppxPackage -Name '*SpotifyMusic*' -ErrorAction Stop } catch {}
if ($appx) {
    Warn 'Spotify is the Microsoft Store version, which Spicetify (and so LyricDock) does not support properly.'
    Info 'It will be replaced with the regular Spotify from spotify.com. You stay signed in to the same account;'
    Info 'only songs downloaded for offline listening need downloading again.'
    $a = Read-Host '             Replace it now? [Y/n]'
    if ($a -match '^[nN]') { Fail 'Install Spotify from https://www.spotify.com/download (not the Microsoft Store), sign in, then run this again.' }
    Info 'Removing the Microsoft Store version...'
    Stop-Process -Name Spotify -Force -ErrorAction SilentlyContinue
    try { $appx | Remove-AppxPackage -ErrorAction Stop } catch { Fail "Couldn't remove it ($($_.Exception.Message)). Uninstall Spotify in Settings -> Apps, then run this again." }
    if (-not (Test-Path "$desk\Spotify.exe")) { Install-SpotifyDesktop }
} elseif (-not (Test-Path "$desk\Spotify.exe")) {
    Info 'Spotify desktop is not installed - installing it...'
    Install-SpotifyDesktop
}
# Spicetify needs Spotify's prefs file, written the first time Spotify runs.
if (-not (Test-Path "$desk\prefs")) {
    Info 'Starting Spotify once so it writes its settings...'
    Start-Process "$desk\Spotify.exe"
    for ($i = 0; $i -lt 90 -and -not (Test-Path "$desk\prefs"); $i++) { Start-Sleep 1 }
    if (-not (Test-Path "$desk\prefs")) { Fail 'Spotify has not finished its first start. Sign in to Spotify, close it, then run this again.' }
}
$spicetify = (Get-Command spicetify -ErrorAction SilentlyContinue).Source
if (-not $spicetify -and (Test-Path "$env:LOCALAPPDATA\spicetify\spicetify.exe")) { $spicetify = "$env:LOCALAPPDATA\spicetify\spicetify.exe" }
if (-not $spicetify) {
    # Same as Spicetify's own installer (spicetify.app), minus its prompts: latest CLI from GitHub into
    # %LOCALAPPDATA%\spicetify, added to the user PATH.
    Info 'Spicetify is not installed - installing it...'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x32' }
    try {
        # Release files follow one name pattern (spicetify-2.x.y-windows-x64.zip), so the tag is all we need - from
        # the API, or from the /releases/latest redirect when the API is rate-limited.
        $tag = Get-LatestTag 'spicetify/cli'
        $name = "spicetify-$($tag.TrimStart('v'))-windows-$arch.zip"
        $zip = Join-Path $env:TEMP $name
        Get-Url @("https://github.com/spicetify/cli/releases/download/$tag/$name") $zip
        $rel = @{ tag_name = $tag }
        $dir = "$env:LOCALAPPDATA\spicetify"
        New-Item -ItemType Directory -Force $dir | Out-Null
        Expand-Archive $zip $dir -Force
        Remove-Item $zip -ErrorAction SilentlyContinue
    } catch { Fail "Couldn't install Spicetify ($($_.Exception.Message)). Install it from https://spicetify.app, then run this again." }
    $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if (($userPath -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('PATH', "$userPath;$dir", 'User') }
    $env:PATH += ";$dir"
    $spicetify = "$dir\spicetify.exe"
    Spice | Out-Null # first run writes its config file
    Ok "Spicetify $($rel.tag_name) installed"
}
# Always point Spicetify at the desktop Spotify: a config left over from the Store version names a folder that
# no longer exists ("is not a valid path").
Spice config spotify_path "$desk" | Out-Null
Spice config prefs_path "$desk\prefs" | Out-Null
$ext = Join-Path (Split-Path (Spice -c | Select-Object -Last 1)) 'Extensions'
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
# The tagged loader: jsDelivr, else GitHub's raw copy of the tag, else the release's own attachment.
try { Get-Url @("https://cdn.jsdelivr.net/gh/$Repo@v$latest/extension/lyricdock.js", "https://raw.githubusercontent.com/$Repo/v$latest/extension/lyricdock.js",
    "https://github.com/$Repo/releases/download/v$latest/lyricdock.js") $tmp }
catch { Fail "Couldn't download the LyricDock loader ($($_.Exception.Message)). Check your connection and run this again." }
if (-not (Select-String -Path $tmp -Pattern 'lyricdockLoader' -Quiet)) { Fail 'The download looks wrong (not the LyricDock loader). Try again in a minute.' }
Copy-Item $tmp (Join-Path $ext 'lyricdock.js') -Force
Remove-Item $tmp -ErrorAction SilentlyContinue
Ok "Loader installed (loads LyricDock v$latest and keeps it updated)"

Section 'CONFIGURING'
Step 6 'Registering updater protocol...'
# lyricdock-updater:// -> this script, so "Update" inside Spotify can start it. It only runs this file from the repo.
$key = 'HKCU:\Software\Classes\lyricdock-updater'
New-Item -Force "$key\shell\open\command" | Out-Null
Set-ItemProperty $key '(default)' 'URL:LyricDock Updater'
Set-ItemProperty $key 'URL Protocol' ''
Set-ItemProperty "$key\shell\open\command" '(default)' "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"iwr -useb $Self | iex`""
Ok 'Updater protocol registered'

Step 7 'Applying Spicetify configuration...'
Spice config extensions 'dock-bridge.js-' | Out-Null # a development copy must not run alongside
Spice config extensions lyricdock.js | Out-Null
Info 'Extension enabled'
$out = Spice apply
if ($SpiceCode) {
    Info 'Spotify probably updated and wiped Spicetify - restoring...'
    $out = Spice backup apply
}
if ($SpiceCode) {
    Info 'Resetting an old Spicetify backup...'
    $out = Spice restore backup apply
}
if ($SpiceCode) { $out | ForEach-Object { Info "$_" }; Fail 'spicetify apply failed (output above).' }
Ok 'Spicetify applied - Spotify is starting'

# v1.0.x installers also put an adb companion app here; LyricDock no longer uses adb, so take it out again.
$oldApp = Join-Path $env:LOCALAPPDATA 'LyricDock\app'
if (Test-Path $oldApp) {
    Get-CimInstance Win32_Process -Filter "Name like 'p%sh%.exe'" |
        Where-Object { $_.CommandLine -like '*LyricDock.ps1*' -or $_.CommandLine -like '*link.ps1*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $oldApp -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($dir in [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup')) {
        $lnk = Join-Path $dir 'LyricDock.lnk'
        if (Test-Path $lnk) { Remove-Item $lnk -ErrorAction SilentlyContinue }
    }
    Info 'Removed the old adb companion (no longer needed)'
}

Section 'PHONE'
Info 'Phone not set up yet? Do this once, either way:'
Info '  - on the phone: install the APK from https://github.com/DhakadG/lyricdock/releases/latest'
Info '  - or from this PC over USB (also turns on full-screen kiosk mode):'
Info '      iwr -useb https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/setup-phone.ps1 | iex'
Info 'Then connect once: Spotify -> LyricDock (top-bar button) -> Devices -> Find devices, tap Allow on the phone and Same digits in Spotify.'
Info 'After that the phone app updates itself.'

Write-Host ''
Write-Host "  LyricDock $latest is ready. Open the LyricDock button in Spotify's top bar." -ForegroundColor Green
Write-Host ''
Start-Sleep -Seconds 4
