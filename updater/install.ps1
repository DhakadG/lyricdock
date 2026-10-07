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
    $o = '' | & $script:spicetify @args 2>&1 | ForEach-Object { "$_" }
    $script:SpiceCode = $LASTEXITCODE
    $o
}
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
try { $latest = (Invoke-RestMethod "$Raw/extension/version.json?t=$([DateTime]::UtcNow.Ticks)" -TimeoutSec 60).version } # 60: Windows PowerShell 5.1 can spend ~21 s on a first connect that then works
catch { Fail "Can't reach GitHub ($($_.Exception.Message)). Check your connection and run this again." }
if ($latest -notmatch '^\d+\.\d+\.\d+$') { Fail "GitHub returned an unexpected version ('$latest')." }
Ok 'Network connected'

Step 2 'Checking Spicetify installation...'
# Spotify must be the regular desktop app in %APPDATA%\Spotify. Microsoft Store Spotify (half supported by
# Spicetify, and its folder changes with every Store update) is swapped for it; no Spotify at all -> installed.
$desk = "$env:APPDATA\Spotify"
function Install-SpotifyDesktop {
    Info 'Downloading Spotify from spotify.com...'
    $setup = Join-Path $env:TEMP 'SpotifySetup.exe'
    try { Invoke-WebRequest -UseBasicParsing 'https://download.scdn.co/SpotifySetup.exe' -OutFile $setup }
    catch { Fail "Couldn't download Spotify ($($_.Exception.Message)). Install it from https://www.spotify.com/download, then run this again." }
    Start-Process $setup '/silent' -Wait
    Remove-Item $setup -ErrorAction SilentlyContinue
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
    for ($i = 0; $i -lt 60 -and -not (Test-Path "$desk\prefs"); $i++) { Start-Sleep 1 }
}
$spicetify = (Get-Command spicetify -ErrorAction SilentlyContinue).Source
if (-not $spicetify -and (Test-Path "$env:LOCALAPPDATA\spicetify\spicetify.exe")) { $spicetify = "$env:LOCALAPPDATA\spicetify\spicetify.exe" }
if (-not $spicetify) {
    # Same as Spicetify's own installer (spicetify.app), minus its prompts: latest CLI from GitHub into
    # %LOCALAPPDATA%\spicetify, added to the user PATH.
    Info 'Spicetify is not installed - installing it...'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x32' }
    try {
        $rel = Invoke-RestMethod 'https://api.github.com/repos/spicetify/cli/releases/latest' -TimeoutSec 60
        $asset = $rel.assets | Where-Object { $_.name -like "*windows-$arch.zip" } | Select-Object -First 1
        if (-not $asset) { throw "no Windows $arch build in $($rel.tag_name)" }
        $zip = Join-Path $env:TEMP $asset.name
        Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $zip
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
try { Invoke-WebRequest -UseBasicParsing "https://cdn.jsdelivr.net/gh/$Repo@v$latest/extension/lyricdock.js" -OutFile $tmp }
catch { Invoke-WebRequest -UseBasicParsing "$Raw/extension/lyricdock.js" -OutFile $tmp } # tag not on the CDN yet
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
