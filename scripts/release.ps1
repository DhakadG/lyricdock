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

if (-not $Notes) { $Notes = (git log --pretty='- %s' "v$current..HEAD" 2>$null) -join "`n"; if (-not $Notes) { $Notes = "LyricDock $Version" } }
git add extension/version.json
git diff --cached --quiet; if ($LASTEXITCODE) { git commit -q -m "Release v$Version" } # first release: version.json already matches
git tag "v$Version"
git push -q --atomic origin main "v$Version"
gh release create "v$Version" $apk --title "LyricDock v$Version" --notes $Notes
Write-Host "Released v$Version - Spotify picks it up on next start (or within 30 min), phones within 6 h."
