# Returns the adb to use: $env:ADB, then adb on PATH, then the SDK's platform-tools (.tools/sdk, ANDROID_HOME,
# Android Studio's default). Use one adb everywhere - two different adb versions keep killing each other's server.
$root = Split-Path $PSScriptRoot
$candidates = @(
    $env:ADB,
    (Get-Command adb -ErrorAction SilentlyContinue).Source,
    "$root\.tools\sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
)
$found = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $found) { throw 'adb not found - install Android platform-tools or set $env:ADB to adb.exe' }
$found
