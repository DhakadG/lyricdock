# Keeps the USB adb forward alive across unplug/replug. Wi-Fi fallback needs nothing from this script.
# Uses `adb` from PATH, or set $env:ADB to its full path.
$adb = if ($env:ADB) { $env:ADB } else { 'adb' }
while ($true) {
    & $adb wait-for-usb-device
    & $adb -d forward tcp:8975 tcp:8975 | Out-Null
    Write-Host "$(Get-Date -f HH:mm:ss) USB link up"
    & $adb wait-for-usb-disconnect
    Write-Host "$(Get-Date -f HH:mm:ss) USB link down (Wi-Fi fallback)"
}
