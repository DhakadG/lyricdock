# Create LyricDock's Cloudflare TURN key from the command line and save it to secrets/ (gitignored). wrangler can't do
# this: it has no TURN command and its login can't be given the permission. Needs a Cloudflare API token with the
# account permission "Calls" (or "Realtime") set to Edit; the token is asked for here and never stored or printed.
#   ./scripts/new-turn-key.ps1
# Guide: docs/setup-guide.md (part 2).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$account = [regex]::Match((Get-Content "$root\cloud\wrangler.jsonc" -Raw), '"ACCOUNT_ID":\s*"(\w+)"').Groups[1].Value
if (-not $account) { throw 'ACCOUNT_ID not found in cloud/wrangler.jsonc' }

$secure = Read-Host 'Paste the Cloudflare API token (it stays hidden)' -AsSecureString
$token = [Net.NetworkCredential]::new('', $secure).Password
$r = Invoke-RestMethod -Method Post "https://api.cloudflare.com/client/v4/accounts/$account/calls/turn_keys" `
  -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{"name":"lyricdock"}'
# Cloudflare answers { uid: the TURN key id, key: its API token, ... }; the token is only ever returned here.
if (-not $r.result.uid -or -not $r.result.key) { throw "Unexpected answer from Cloudflare (fields: $($r.result.PSObject.Properties.Name -join ', '))" }

New-Item -ItemType Directory -Force "$root\secrets" | Out-Null
Set-Content "$root\secrets\TURN_KEY_ID.txt" $r.result.uid -NoNewline
Set-Content "$root\secrets\TURN_KEY_TOKEN.txt" $r.result.key -NoNewline
Write-Host "TURN key '$($r.result.name)' created and saved to secrets\TURN_KEY_ID.txt + secrets\TURN_KEY_TOKEN.txt."
Write-Host 'You can delete the API token you pasted now (Cloudflare dashboard -> My Profile -> API Tokens); the TURN key keeps working.'
