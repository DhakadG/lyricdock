# Keeps localhost:8975 on this PC pointed at the LyricDock phone: over USB when the cable is in, over wireless adb
# when it isn't, and back to USB the moment it returns. Spotify's bridge only ever talks to localhost (Chromium
# blocks ws:// to LAN addresses from Spotify's https page), so this is what makes Wi-Fi work.
#
#   ./scripts/link.ps1            run in a terminal (or ./scripts/autostart.ps1 to start it hidden at login)
#
# - adb comes from find-adb.ps1 ($env:ADB, PATH, or the SDK's platform-tools).
# - The phone's Wi-Fi IP is learned over USB and remembered in %LOCALAPPDATA%\LyricDock, so a restart of this
#   script (or the PC) reconnects over Wi-Fi without the cable.
# - Wireless adb is switched on (`adb tcpip 5555`) over USB once per phone boot; Android turns it off on reboot,
#   so after a phone reboot the cable is needed once. Anyone on your network whose adb key the phone has
#   authorised could connect too - same as Android's own wireless debugging. `adb usb` turns it off.
# - Only one copy runs at a time.
$ErrorActionPreference = 'Continue'
$mutex = [Threading.Mutex]::new($false, 'Local\LyricDockLink')
if (-not $mutex.WaitOne(0)) { Write-Host 'link.ps1 is already running'; exit }

$adb = & "$PSScriptRoot\find-adb.ps1"
$port = 8975; $tcp = 5555; $pkg = 'com.you.lyricdock'
$state = "$env:LOCALAPPDATA\LyricDock"; New-Item -ItemType Directory -Force $state | Out-Null
$ipFile = "$state\last-ip.txt"; $logFile = "$state\link.log"
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) { Move-Item $logFile "$logFile.old" -Force }

function Log($m) { $l = "$(Get-Date -f 'yyyy-MM-dd HH:mm:ss') $m"; Write-Host $l; Add-Content $logFile $l }
$ip = if (Test-Path $ipFile) { (Get-Content $ipFile -Raw).Trim() } else { $null }
if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { $ip = $null }
Log "using $adb$(if ($ip) { " - last phone IP $ip" })"

$mode = $null; $hasApp = @{}; $nextIpCheck = 0; $nextConnect = 0; $wifiFails = 0; $warned = $false
function Now { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Q { $o = & $adb @args 2>$null; if ($LASTEXITCODE) { $null } else { $o } }   # adb, quiet; $null on failure

while ($true) {
    $devs = @(Q devices) | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] }
    # USB serials are the ones without ip:port; only phones that have LyricDock installed count.
    $usb = $devs | Where-Object { $_ -notmatch ':\d+$' } | Where-Object {
        if (-not $hasApp.ContainsKey($_)) { $hasApp[$_] = [bool](Q -s $_ shell pm path $pkg) }
        $hasApp[$_]
    } | Select-Object -First 1
    $wifi = if ($ip) { "${ip}:$tcp" } else { $null }
    $wifiUp = $wifi -and ($devs -contains $wifi)
    $fwd = @(Q forward --list)

    if ($usb) {
        if ($wifiUp -and $mode -ne 'usb') { Q disconnect $wifi | Out-Null } # drop Wi-Fi streams: Spotify reconnects over USB
        # Re-check every cycle: an adb server restart (e.g. another adb version) silently drops forwards.
        if (-not ($fwd -match "^$([regex]::Escape($usb))\s+tcp:$port\s")) { Q -s $usb forward "tcp:$port" "tcp:$port" | Out-Null }
        if ($mode -ne 'usb') { $mode = 'usb'; $wifiFails = 0; $warned = $false; Log "USB link up ($usb)" }
        if ((Now) -gt $nextIpCheck) {
            $nextIpCheck = (Now) + 10000
            $inet = @(Q -s $usb shell 'ip -4 addr show wlan0') | Select-String 'inet (\d+\.\d+\.\d+\.\d+)' | Select-Object -First 1
            if ($inet) {
                $now = $inet.Matches[0].Groups[1].Value
                if ($now -ne $ip) { $ip = $now; Set-Content $ipFile $ip; Log "phone Wi-Fi IP $ip" }
            }
            $tcpPort = Q -s $usb shell getprop service.adb.tcp.port
            if ($null -ne $tcpPort -and "$tcpPort".Trim() -ne "$tcp") {
                Q -s $usb tcpip $tcp | Out-Null
                Log 'wireless adb enabled'
                Start-Sleep -Seconds 3   # adbd restarts and the USB session blinks; don't read that as the cable leaving
                continue
            }
        }
    }
    elseif ($wifi) {
        if (-not $wifiUp -and (Now) -gt $nextConnect) {
            $nextConnect = (Now) + 2000
            Q connect $wifi | Out-Null
            $wifiUp = @(Q devices) -match "^$([regex]::Escape($wifi))\s+device$"
            if (-not $wifiUp) {
                $wifiFails++
                if ($wifiFails -eq 1 -and $mode -ne 'down') { $mode = 'down'; Log "no USB, trying Wi-Fi $wifi" }
                if ($wifiFails -ge 15 -and -not $warned) {
                    $warned = $true
                    Log "phone not reachable at $wifi. If it rebooted (wireless adb resets on boot) or changed network, plug in USB once."
                }
            }
        }
        if ($wifiUp) {
            if (-not ($fwd -match "^$([regex]::Escape($wifi))\s+tcp:$port\s")) { Q -s $wifi forward "tcp:$port" "tcp:$port" | Out-Null }
            if ($mode -ne 'wifi') { $mode = 'wifi'; $wifiFails = 0; $warned = $false; Log "Wi-Fi link up ($wifi)" }
        }
    }
    elseif ($mode -ne 'waiting') { $mode = 'waiting'; Log 'waiting for the phone on USB (first time: plug it in once)' }
    Start-Sleep -Milliseconds 700
}
