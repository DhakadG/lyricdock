# Keeps localhost:8975 on this PC pointed at the phone: over USB when the cable is in, over wireless adb when it
# isn't, and back to USB the moment it returns. Spotify's bridge only ever talks to localhost (Chromium blocks
# ws:// to LAN addresses from Spotify's https page), so this is what makes Wi-Fi work.
# Leave it running. adb is located by find-adb.ps1 ($env:ADB, PATH, or the SDK's platform-tools).
#
# Wireless adb: while on USB the phone is switched to `adb tcpip 5555` once per boot, and its Wi-Fi IP is learned.
# Anyone on your network with an adb key the phone has authorised could then connect - same as Android's own
# wireless debugging. Run `adb usb` to turn it off.
$adb = & "$PSScriptRoot\find-adb.ps1"
Write-Host "using $adb"
$port = 8975; $tcp = 5555
$ip = $null; $mode = $null

function Usb { (& $adb devices) -match '^\S+\s+device$' | Where-Object { $_ -notmatch ':\d+\s' } | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1 }
function Log($m) { Write-Host "$(Get-Date -f HH:mm:ss) $m" }

while ($true) {
    $usb = Usb
    if ($usb) {
        if ($mode -ne 'usb') {
            if ($ip) { & $adb disconnect "${ip}:$tcp" *> $null }   # drop Wi-Fi streams so Spotify reconnects over USB
            & $adb -s $usb forward "tcp:$port" "tcp:$port" | Out-Null
            $mode = 'usb'; Log "USB link up ($usb)"
        }
        $now = ((& $adb -s $usb shell 'ip -4 addr show wlan0' 2>$null) | Select-String 'inet (\d+\.\d+\.\d+\.\d+)').Matches.Groups[1].Value
        if ($now -and $now -ne $ip) { $ip = $now; Log "phone Wi-Fi IP $ip" }
        if ((& $adb -s $usb shell getprop service.adb.tcp.port 2>$null) -ne "$tcp") { & $adb -s $usb tcpip $tcp | Out-Null; Log "wireless adb enabled" }
    }
    elseif ($ip) {
        if ($mode -ne 'wifi') {
            & $adb connect "${ip}:$tcp" | Out-Null
            if ((& $adb devices) -match [regex]::Escape("${ip}:$tcp") + '\s+device') {
                & $adb -s "${ip}:$tcp" forward "tcp:$port" "tcp:$port" | Out-Null
                $mode = 'wifi'; Log "Wi-Fi link up (${ip}:$tcp)"
            } elseif ($mode -ne 'down') { $mode = 'down'; Log "no USB and Wi-Fi adb unreachable - retrying" }
        }
        elseif (-not ((& $adb devices) -match [regex]::Escape("${ip}:$tcp") + '\s+device')) { $mode = $null }
    }
    elseif ($mode -ne 'waiting') { $mode = 'waiting'; Log "waiting for the phone on USB" }
    Start-Sleep -Milliseconds 700
}
