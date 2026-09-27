# Build the app (Gradle-free) and push it to the phone. Keeps device-owner; the app restarts on the new build.
# With the phone on both USB and wireless adb, plain `adb install` refuses ("more than one device"), so pick one:
# USB if present, else the Wi-Fi connection.
$root = Split-Path $PSScriptRoot
$adb = & "$PSScriptRoot\find-adb.ps1"
& "$PSScriptRoot\build-apk.ps1"
if (-not $?) { exit 1 }
$devs = @(& $adb devices) | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] }
$dev = ($devs | Where-Object { $_ -notmatch ':\d+$' } | Select-Object -First 1) ?? ($devs | Select-Object -First 1)
if (-not $dev) { throw 'No phone connected (USB or wireless adb).' }
& $adb -s $dev install -r -t "$root\android\build\lite\lyricdock.apk"
& $adb -s $dev shell am start -n com.you.lyricdock/.MainActivity
