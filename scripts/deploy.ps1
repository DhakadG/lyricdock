# Build the app (Gradle-free) and push it to the phone. Keeps device-owner; the app restarts on the new build.
$root = Split-Path $PSScriptRoot
$adb = & "$PSScriptRoot\find-adb.ps1"
& "$PSScriptRoot\build-apk.ps1"
if (-not $?) { exit 1 }
& $adb install -r -t "$root\android\build\lite\lyricdock.apk"
& $adb shell am start -n com.you.lyricdock/.MainActivity
