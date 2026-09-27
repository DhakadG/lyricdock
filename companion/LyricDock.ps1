# LyricDock companion for Windows: a tray app for everything the Spotify extension can't do from inside Spotify
# (it can't start programs): the USB / wireless-adb link, phone controls over adb, installing and updating.
# Optional - the phone and Spotify also connect without it (direct Wi-Fi / WebRTC after pairing).
#   powershell -ExecutionPolicy Bypass -File LyricDock.ps1 [-Tray]      (-Tray: start hidden in the tray)
# Installed by updater/install.ps1 to %LOCALAPPDATA%\LyricDock\app with link.ps1 + find-adb.ps1 next to it.
# Windows PowerShell 5.1 compatible (no ?? / ternaries).
param([switch]$Tray)
$ErrorActionPreference = 'Continue'
$mutex = New-Object Threading.Mutex($false, 'Local\LyricDockCompanion')
if (-not $mutex.WaitOne(0)) { exit } # already running (its tray icon is there)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$Repo = 'DhakadG/lyricdock'; $Pkg = 'com.you.lyricdock'
$State = "$env:LOCALAPPDATA\LyricDock"; New-Item -ItemType Directory -Force $State | Out-Null
$Shell = (Get-Process -Id $PID).Path # the same PowerShell runs the helpers
$LinkScript = Join-Path $PSScriptRoot 'link.ps1'
if (-not (Test-Path $LinkScript)) { $LinkScript = Join-Path (Split-Path $PSScriptRoot) 'scripts\link.ps1' } # repo checkout
$FindAdb = Join-Path (Split-Path $LinkScript) 'find-adb.ps1'
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'LyricDock.lnk'
$SettingsFile = "$State\companion.json"

function Load-Settings {
    $d = @{ link = $true }
    if (Test-Path $SettingsFile) { try { (Get-Content $SettingsFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $d[$_.Name] = $_.Value } } catch {} }
    $d
}
$Cfg = Load-Settings
function Save-Settings { $Cfg | ConvertTo-Json | Set-Content $SettingsFile }

# ---- adb
function Get-Adb { try { & $FindAdb } catch { $null } }
$script:Adb = Get-Adb
function A { if (-not $script:Adb) { return $null }; $o = & $script:Adb @args 2>$null; if ($LASTEXITCODE) { $null } else { $o } }
function Phone { # serial of the connected LyricDock phone, USB first
    $devs = @(A devices) | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] }
    $usb = $devs | Where-Object { $_ -notmatch ':\d+$' } | Select-Object -First 1
    if ($usb) { $usb } else { $devs | Select-Object -First 1 }
}
function AP { $s = Phone; if (-not $s) { return $null }; A -s $s @args } # adb on the phone

function Get-PlatformTools { # Google's official platform-tools, into %LOCALAPPDATA%\LyricDock
    $zip = "$env:TEMP\platform-tools.zip"
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
        Expand-Archive $zip $State -Force
        Remove-Item $zip -ErrorAction SilentlyContinue
        $script:Adb = Get-Adb
        [bool]$script:Adb
    } catch { $false }
}

# ---- link.ps1 as a hidden child (it holds its own single-instance mutex, so a second start just exits)
$script:LinkProc = $null
function Start-Link {
    if (-not $script:Adb -or -not (Test-Path $LinkScript)) { return }
    if ($script:LinkProc -and -not $script:LinkProc.HasExited) { return }
    $script:LinkProc = Start-Process $Shell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LinkScript`"" -WindowStyle Hidden -PassThru
}
function Stop-Link {
    Get-CimInstance Win32_Process -Filter "Name like 'p%sh%.exe'" | Where-Object { $_.CommandLine -like '*link.ps1*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $script:LinkProc = $null
}
function Link-Running { [bool](Get-CimInstance Win32_Process -Filter "Name like 'p%sh%.exe'" | Where-Object { $_.CommandLine -like '*link.ps1*' }) }
function Last-LinkLog { $f = "$State\link.log"; if (Test-Path $f) { (Get-Content $f -Tail 1) -replace '^\S+ \S+ ', '' } else { '' } }

function Set-Autostart($on) {
    if (-not $on) { Remove-Item $Startup -ErrorAction SilentlyContinue; return }
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($Startup)
    $s.TargetPath = $Shell
    $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Tray"
    $s.WorkingDirectory = $PSScriptRoot; $s.WindowStyle = 7; $s.Description = 'LyricDock companion'
    $s.Save()
}

# Long jobs (downloads, installs) run in their own visible console so the user sees progress and the UI stays live.
function Run-Console($title, $code) {
    $f = "$env:TEMP\lyricdock-$([guid]::NewGuid().ToString('n').Substring(0,8)).ps1"
    Set-Content $f "`$Host.UI.RawUI.WindowTitle = '$title'`n$code`nWrite-Host ''`nRead-Host 'Done - press Enter to close'"
    Start-Process $Shell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$f`""
}
$UpdatePhone = @"
`$ErrorActionPreference = 'Stop'; `$ProgressPreference = 'SilentlyContinue'
`$rel = Invoke-RestMethod https://api.github.com/repos/$Repo/releases/latest
`$a = `$rel.assets | Where-Object name -like '*.apk' | Select-Object -First 1
Write-Host "Downloading `$(`$a.name)..."
Invoke-WebRequest -UseBasicParsing `$a.browser_download_url -OutFile "`$env:TEMP\`$(`$a.name)"
Write-Host 'Installing on the phone...'
& '$($script:Adb)' install -r -t "`$env:TEMP\`$(`$a.name)"
& '$($script:Adb)' shell am start -n $Pkg/.MainActivity | Out-Null
Write-Host "Phone app is `$(`$rel.tag_name)" -ForegroundColor Green
"@

# ---- icon: the app icon's screen-on-a-stand, drawn so no .ico has to ship
function New-Icon {
    $b = New-Object Drawing.Bitmap 32, 32
    $g = [Drawing.Graphics]::FromImage($b); $g.SmoothingMode = 'AntiAlias'
    $g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(22, 22, 26))), 2, 5, 28, 19)
    $g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(61, 220, 151))), 7, 12, 18, 3)
    $g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(120, 255, 255, 255))), 7, 17, 12, 2)
    $g.FillRectangle([Drawing.Brushes]::Gray, 14, 24, 4, 4); $g.FillRectangle([Drawing.Brushes]::Gray, 9, 28, 14, 2)
    [Drawing.Icon]::FromHandle($b.GetHicon())
}
$Icon = New-Icon

# ---- window
$Dark = [Drawing.Color]::FromArgb(24, 24, 28); $Card = [Drawing.Color]::FromArgb(36, 36, 42); $Fg = [Drawing.Color]::WhiteSmoke
$Mint = [Drawing.Color]::FromArgb(61, 220, 151); $Muted = [Drawing.Color]::FromArgb(160, 160, 170)
$form = New-Object Windows.Forms.Form
$form.Text = 'LyricDock'; $form.Icon = $Icon; $form.BackColor = $Dark; $form.ForeColor = $Fg
$form.Font = New-Object Drawing.Font('Segoe UI', 9.5); $form.ClientSize = New-Object Drawing.Size(760, 560)
$form.FormBorderStyle = 'FixedSingle'; $form.MaximizeBox = $false; $form.StartPosition = 'CenterScreen'

$left = New-Object Windows.Forms.FlowLayoutPanel
$left.FlowDirection = 'TopDown'; $left.WrapContents = $false; $left.AutoScroll = $true
$left.Location = New-Object Drawing.Point(14, 12); $left.Size = New-Object Drawing.Size(400, 536)
$form.Controls.Add($left)

function Header($t) { $l = New-Object Windows.Forms.Label; $l.Text = $t; $l.Font = New-Object Drawing.Font('Segoe UI Semibold', 11); $l.AutoSize = $true; $l.Margin = '0,10,0,4'; $left.Controls.Add($l) }
function Label($t, $dim) { $l = New-Object Windows.Forms.Label; $l.Text = $t; $l.AutoSize = $true; $l.MaximumSize = '360,0'; if ($dim) { $l.ForeColor = $Muted }; $left.Controls.Add($l); $l }
function Check($t, $on, $act) { $c = New-Object Windows.Forms.CheckBox; $c.Text = $t; $c.Checked = $on; $c.AutoSize = $true; $c.Add_CheckedChanged($act); $left.Controls.Add($c); $c }
function Buttons($defs) { # @( @('Text', {action}), ... ) on one row
    $row = New-Object Windows.Forms.FlowLayoutPanel; $row.AutoSize = $true; $row.WrapContents = $true; $row.MaximumSize = '370,0'; $row.Margin = '0,2,0,2'
    foreach ($d in $defs) {
        $b = New-Object Windows.Forms.Button; $b.Text = $d[0]; $b.AutoSize = $true; $b.FlatStyle = 'Flat'; $b.BackColor = $Card
        $b.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(70, 70, 80); $b.Add_Click($d[1]); $row.Controls.Add($b)
    }
    $left.Controls.Add($row)
}

Header 'Status'
$lblPhone = Label 'Phone: ...'
$lblLink = Label 'Link: ...' $true
$lblVer = Label 'Versions: ...' $true

Header 'Connection'
Label 'Spotify reaches the phone directly over Wi-Fi once paired (WebRTC). The adb link adds a wired path (USB) and wireless adb - faster to reconnect, and needed for the phone controls below.' $true | Out-Null
$chkLink = Check 'Keep the USB / wireless-adb link running' ([bool]$Cfg.link) {
    $Cfg.link = $chkLink.Checked; Save-Settings
    if ($chkLink.Checked) { Start-Link } else { Stop-Link }
}
$chkAuto = Check 'Start LyricDock companion with Windows' (Test-Path $Startup) { Set-Autostart $chkAuto.Checked }
Buttons @(
    @('Get adb', { if (Get-PlatformTools) { [Windows.Forms.MessageBox]::Show('adb installed.') | Out-Null; if ($Cfg.link) { Start-Link } } else { [Windows.Forms.MessageBox]::Show('Download failed.') | Out-Null } }),
    @('Open link log', { if (Test-Path "$State\link.log") { Start-Process notepad "$State\link.log" } })
)

Header 'Phone'
$bright = New-Object Windows.Forms.TrackBar; $bright.Minimum = 1; $bright.Maximum = 255; $bright.TickStyle = 'None'; $bright.Width = 355; $bright.Value = 128
$bright.Add_MouseUp({ AP shell settings put system screen_brightness_mode 0 | Out-Null; AP shell settings put system screen_brightness $bright.Value | Out-Null })
Label 'Screen brightness' $true | Out-Null
$left.Controls.Add($bright)
$chkAwake = Check 'Keep the screen on while charging' $false {
    $v = 0; if ($chkAwake.Checked) { $v = 7 }; AP shell settings put global stay_on_while_plugged_in $v | Out-Null
}
Buttons @(
    @('Restart app', { AP shell am force-stop $Pkg | Out-Null; AP shell am start -n "$Pkg/.MainActivity" | Out-Null }),
    @('Screen off / on', { AP shell input keyevent 26 | Out-Null }),
    @('Reboot phone', { if ([Windows.Forms.MessageBox]::Show('Reboot the phone?', 'LyricDock', 'YesNo') -eq 'Yes') { AP reboot | Out-Null } }),
    @('Update phone app', { if (Phone) { Run-Console 'Update LyricDock phone app' $UpdatePhone } else { [Windows.Forms.MessageBox]::Show('No phone on adb.') | Out-Null } })
)

Header 'Spotify'
Buttons @(
    @('Install / repair extension', { Run-Console 'LyricDock installer' "iwr -useb https://raw.githubusercontent.com/$Repo/main/updater/install.ps1 | iex" }),
    @('Releases', { Start-Process "https://github.com/$Repo/releases" }),
    @('Help', { Start-Process "https://github.com/$Repo#readme" })
)

# right: live phone screen
$shot = New-Object Windows.Forms.PictureBox
$shot.Location = New-Object Drawing.Point(428, 16); $shot.Size = New-Object Drawing.Size(318, 480); $shot.SizeMode = 'Zoom'; $shot.BackColor = $Card
$form.Controls.Add($shot)
$chkLive = New-Object Windows.Forms.CheckBox; $chkLive.Text = 'Live phone screen'; $chkLive.AutoSize = $true; $chkLive.Location = New-Object Drawing.Point(428, 508)
$form.Controls.Add($chkLive)
function Refresh-Shot {
    $s = Phone; if (-not $s) { return }
    $f = "$env:TEMP\lyricdock-screen.png"
    cmd /c "`"$($script:Adb)`" -s $s exec-out screencap -p > `"$f`"" 2>$null # cmd: PowerShell's > would mangle the binary
    try {
        $ms = New-Object IO.MemoryStream(, [IO.File]::ReadAllBytes($f))
        $img = [Drawing.Image]::FromStream($ms)
        if ($img.Width -gt $img.Height) { $img.RotateFlip('Rotate90FlipNone') } # landscape dock: show it upright in the tall box
        $old = $shot.Image; $shot.Image = $img; if ($old) { $old.Dispose() }
    } catch {}
}
$shot.Add_Click({ Refresh-Shot })

# ---- status refresh
$script:Tick = 0
function Refresh-Status {
    $script:Tick++
    if (-not $script:Adb) { $script:Adb = Get-Adb }
    if (-not $script:Adb) {
        $lblPhone.Text = 'Phone: adb not installed - click "Get adb" for the USB link and phone controls (optional)'
        $lblLink.Text = ''; return
    }
    $s = Phone
    if ($s) {
        $how = 'USB'; if ($s -match ':\d+$') { $how = 'Wi-Fi (wireless adb)' }
        $model = (AP shell getprop ro.product.model) -join ''
        $lblPhone.Text = "Phone: $model connected over $how"; $lblPhone.ForeColor = $Mint
        if ($script:Tick % 10 -eq 1) {
            $pv = ((AP shell dumpsys package $Pkg) | Select-String 'versionName=(\S+)' | Select-Object -First 1).Matches.Groups[1].Value
            $lv = try { (Invoke-RestMethod "https://raw.githubusercontent.com/$Repo/main/extension/version.json" -TimeoutSec 5).version } catch { '?' }
            $lblVer.Text = "Phone app v$pv  -  latest v$lv"
        }
    } else { $lblPhone.Text = 'Phone: not on adb (plug in USB, or it may still be linked over Wi-Fi/WebRTC)'; $lblPhone.ForeColor = $Fg }
    $lblLink.Text = 'Link: ' + $(if (Link-Running) { "running - $(Last-LinkLog)" } else { 'off' })
    if ($Cfg.link -and -not (Link-Running)) { Start-Link } # keep it alive (it exits on its own errors)
    if ($chkLive.Checked -and $form.Visible) { Refresh-Shot }
}
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 3000; $timer.Add_Tick({ Refresh-Status }); $timer.Start()

# ---- tray
$notify = New-Object Windows.Forms.NotifyIcon; $notify.Icon = $Icon; $notify.Text = 'LyricDock'; $notify.Visible = $true
$menu = New-Object Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('Open LyricDock', $null, { $form.Show(); $form.Activate() })
[void]$menu.Items.Add('Restart phone app', $null, { AP shell am force-stop $Pkg | Out-Null; AP shell am start -n "$Pkg/.MainActivity" | Out-Null })
[void]$menu.Items.Add('-')
[void]$menu.Items.Add('Quit (stops the adb link)', $null, { $script:Quit = $true; Stop-Link; $notify.Visible = $false; [Windows.Forms.Application]::Exit() })
$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ $form.Show(); $form.Activate() })
$form.Add_FormClosing({ param($s, $e) if (-not $script:Quit) { $e.Cancel = $true; $form.Hide(); $notify.ShowBalloonTip(2000, 'LyricDock', 'Still running in the tray.', 'None') } })

Refresh-Status
if ($Tray) { $appCtx = New-Object Windows.Forms.ApplicationContext; [Windows.Forms.Application]::Run($appCtx) }
else { [Windows.Forms.Application]::Run($form) }
