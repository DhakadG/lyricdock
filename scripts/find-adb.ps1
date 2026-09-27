# Returns the adb to use: $env:ADB, then adb on PATH, then the SDK's platform-tools (.tools/sdk, ANDROID_HOME,
# Android Studio's default). Use one adb everywhere - two different adb versions keep killing each other's server.
$root = Split-Path $PSScriptRoot
$candidates = @(
    $env:ADB,
    $(if (Test-Path "$env:LOCALAPPDATA\LyricDock\adb-path.txt") { (Get-Content "$env:LOCALAPPDATA\LyricDock\adb-path.txt" -Raw).Trim() }),
    (Get-Command adb -ErrorAction SilentlyContinue).Source,
    "$root\.tools\sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:LOCALAPPDATA\LyricDock\platform-tools\adb.exe"   # the companion's "Get adb"
)
$found = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $found) { throw 'adb not found - install Android platform-tools or set $env:ADB to adb.exe' }
# Remembered so the web installer and the companion (which don't live in this checkout) use the same adb.
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\LyricDock" | Out-Null
Set-Content "$env:LOCALAPPDATA\LyricDock\adb-path.txt" $found
$found
