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
Step 6 'Registering updater protocol...'
# lyricdock-updater:// -> this script, so "Update" inside Spotify can start it. It only runs this file from the repo.
$key = 'HKCU:\Software\Classes\lyricdock-updater'
New-Item -Force "$key\shell\open\command" | Out-Null
Set-ItemProperty $key '(default)' 'URL:LyricDock Updater'
Set-ItemProperty $key 'URL Protocol' ''
Set-ItemProperty "$key\shell\open\command" '(default)' "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"iwr -useb $Self | iex`""
Ok 'Updater protocol registered'

Step 7 'Applying Spicetify configuration...'
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
Info 'Then pair once: type the code the phone shows into Spotify -> LyricDock (top-bar button) -> Pair.'
Info 'After that the phone app updates itself.'

Write-Host ''
Write-Host "  LyricDock $latest is ready. Open the LyricDock button in Spotify's top bar." -ForegroundColor Green
Write-Host ''
Start-Sleep -Seconds 4
