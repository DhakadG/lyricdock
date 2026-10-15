# Format every source file in the repo (npm run format). Layout only, never behaviour.
#   Prettier                 JS, CSS, HTML, JSON, Markdown, YAML, XML, SVG, shell, TOML   (.prettierrc.json)
#   google-java-format       Java (AOSP style: 4-space indent, like Android's own sources)
#   PSScriptAnalyzer         PowerShell (hashtables and assignment blocks aligned on '=')
#   rustfmt                  the Windows helper
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Set-Location $root

# Prettier: run twice, a few comment placements only settle on the second pass.
npx prettier --write --log-level warn .
npx prettier --write --log-level warn .
if ($LASTEXITCODE) { throw 'prettier failed' }

# Java: fetched once from Maven Central, like build-apk.ps1's jars.
$gjf = "$root\.tools\libs\google-java-format-1.28.0-all-deps.jar"
if (-not (Test-Path $gjf)) {
    New-Item -ItemType Directory -Force (Split-Path $gjf) | Out-Null
    Invoke-WebRequest 'https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format/1.28.0/google-java-format-1.28.0-all-deps.jar' -OutFile $gjf
}
$java = Get-ChildItem "$root\android\app\src\main\java" -Recurse -Filter *.java | ForEach-Object FullName
java -jar $gjf --aosp --skip-sorting-imports --skip-removing-unused-imports --replace @java
if ($LASTEXITCODE) { throw 'google-java-format failed' }

# PowerShell
if (-not (Get-Module -ListAvailable PSScriptAnalyzer)) { Install-Module PSScriptAnalyzer -Scope CurrentUser -Force }
$settings = @{
    IncludeRules = @('PSPlaceOpenBrace', 'PSPlaceCloseBrace', 'PSUseConsistentIndentation', 'PSUseConsistentWhitespace', 'PSAlignAssignmentStatement')
    Rules        = @{
        PSPlaceOpenBrace           = @{ Enable = $true; OnSameLine = $true; NewLineAfter = $true; IgnoreOneLineBlock = $true }
        PSPlaceCloseBrace          = @{ Enable = $true; NewLineAfter = $false; IgnoreOneLineBlock = $true; NoEmptyLineBefore = $false }
        PSUseConsistentIndentation = @{ Enable = $true; IndentationSize = 4; Kind = 'space'; PipelineIndentation = 'IncreaseIndentationForFirstPipeline' }
        PSUseConsistentWhitespace  = @{ Enable = $true; CheckOpenBrace = $true; CheckOpenParen = $true; CheckOperator = $true; CheckSeparator = $true; CheckPipe = $true; CheckInnerBrace = $true; CheckParameter = $false }
        PSAlignAssignmentStatement = @{ Enable = $true; CheckHashtable = $true }
    }
}
$ps = @(git ls-files '*.ps1') + @('New-RepoTreemap.ps1' | Where-Object { Test-Path $_ })
foreach ($f in $ps) {
    $src = [IO.File]::ReadAllText("$root\$f")
    $out = Invoke-Formatter -ScriptDefinition $src -Settings $settings
    if ($out -ne $src) { [IO.File]::WriteAllText("$root\$f", $out) }
}

# Rust
cargo fmt --manifest-path "$root\helper\src-tauri\Cargo.toml"
if ($LASTEXITCODE) { throw 'cargo fmt failed' }
Write-Host 'formatted'
