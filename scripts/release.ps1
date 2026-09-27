# Publish a LyricDock release: every installed copy updates itself from this.
#   ./scripts/release.ps1 -Version 1.2.0 [-Notes "what changed"]
# - extension/version.json is the one version for everything (the loader reads it on GitHub; the APK is built with it)
# - the git tag vX.Y.Z is what jsDelivr serves the extension from (immutable), so the tag and main are pushed together
# - the APK goes on a GitHub Release, where the phone app's updater finds it
param([Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version, [string]$Notes)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Set-Location $root
if (git status --porcelain) { throw 'Commit or stash your changes first.' }
$current = (Get-Content extension\version.json -Raw | ConvertFrom-Json).version
if (git tag -l "v$Version") { throw "v$Version is already released." }
if ([version]$Version -lt [version]$current) { throw "Version must not be older than $current." }

Set-Content extension\version.json "{ `"version`": `"$Version`" }`n" -NoNewline
& "$PSScriptRoot\build-apk.ps1"
$apk = "$root\android\build\lyricdock-v$Version.apk"
Copy-Item "$root\android\build\lite\lyricdock.apk" $apk -Force
# Windows helper (Tauri): same version, attached to the release as a portable exe.
(Get-Content "$root\helper\src-tauri\tauri.conf.json" -Raw) -replace '"version": "[\d.]+"', """version"": ""$Version""" | Set-Content "$root\helper\src-tauri\tauri.conf.json" -NoNewline
(Get-Content "$root\helper\src-tauri\Cargo.toml" -Raw) -replace '(?m)^version = "[\d.]+"', "version = `"$Version`"" | Set-Content "$root\helper\src-tauri\Cargo.toml" -NoNewline
Push-Location "$root\helper\src-tauri"; & "$env:USERPROFILE\.cargo\bin\cargo.exe" build --release; if ($LASTEXITCODE) { Pop-Location; throw 'helper build failed' }; Pop-Location
$helperExe = "$root\android\build\LyricDock-Helper-v$Version.exe"
Copy-Item "$root\helper\src-tauri\target\release\lyricdock-helper.exe" $helperExe -Force

if (-not $Notes) { $Notes = (git log --pretty='- %s' "v$current..HEAD" 2>$null) -join "`n"; if (-not $Notes) { $Notes = "LyricDock $Version" } }
git add extension/version.json helper/src-tauri/tauri.conf.json helper/src-tauri/Cargo.toml helper/src-tauri/Cargo.lock
git diff --cached --quiet; if ($LASTEXITCODE) { git commit -q -m "Release v$Version" } # first release: version.json already matches
git tag "v$Version"
git push -q --atomic origin main "v$Version"
gh release create "v$Version" $apk $helperExe --title "LyricDock v$Version" --notes $Notes
Write-Host "Released v$Version - Spotify picks it up on next start (or within 30 min), phones within 6 h."
