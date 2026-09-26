# Gradle-free debug APK build: aapt2 + javac + d8 + zipalign + apksigner.
# Same output as `gradle assembleDebug` (same debug key, so it installs over it), no Gradle daemon needed.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$root\.tools\sdk" }
$bt = (Get-ChildItem "$sdk\build-tools" | Sort-Object Name | Select-Object -Last 1).FullName
$jar = "$sdk\platforms\android-34\android.jar"
$app = "$root\android\app\src\main"
$out = "$root\android\build\lite"
# Runtime deps (same as android/app/build.gradle): reuse Gradle's cache, else fetch from Maven Central once.
$libDir = "$root\.tools\libs"
$libs = foreach ($d in @(
        @{ g = 'org/java-websocket'; a = 'Java-WebSocket'; v = '1.5.7' },
        @{ g = 'org/slf4j'; a = 'slf4j-api'; v = '2.0.6' })) {
    $name = "$($d.a)-$($d.v).jar"
    $cached = Get-ChildItem "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1" -Recurse -Filter $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cached) { $cached.FullName; continue }
    New-Item -ItemType Directory -Force $libDir | Out-Null
    if (-not (Test-Path "$libDir\$name")) {
        Invoke-WebRequest "https://repo1.maven.org/maven2/$($d.g)/$($d.a)/$($d.v)/$name" -OutFile "$libDir\$name"
    }
    "$libDir\$name"
}

# Android's standard debug key; Android Studio creates it too - make it if this machine never ran one.
$ks = "$env:USERPROFILE\.android\debug.keystore"
if (-not (Test-Path $ks)) {
    New-Item -ItemType Directory -Force (Split-Path $ks) | Out-Null
    keytool -genkeypair -keystore $ks -storepass android -keypass android -alias androiddebugkey `
        -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000
}

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory "$out\gen", "$out\classes" | Out-Null

# AGP normally injects these from build.gradle.
$manifest = (Get-Content "$app\AndroidManifest.xml" -Raw) -replace '<manifest ', '<manifest package="com.you.lyricdock" android:versionCode="1" android:versionName="0.1" '
Set-Content "$out\AndroidManifest.xml" $manifest

& "$bt\aapt2.exe" compile --dir "$app\res" -o "$out\res.zip"
& "$bt\aapt2.exe" link -I $jar --manifest "$out\AndroidManifest.xml" -A "$app\assets" --java "$out\gen" `
    --min-sdk-version 26 --target-sdk-version 34 --debug-mode -o "$out\base.apk" "$out\res.zip"
if ($LASTEXITCODE) { throw 'aapt2 link failed' }

$src = @(Get-ChildItem "$app\java", "$out\gen" -Recurse -Filter *.java | ForEach-Object FullName)
# -g: with javac's default debug info, d8 8.x NPEs on the inner classes.
javac -nowarn -g -source 8 -target 8 -bootclasspath $jar -cp ($libs -join ';') -d "$out\classes" @src 2>&1 | Where-Object { $_ -notmatch 'warning' }
if ($LASTEXITCODE) { throw 'javac failed' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
# d8 8.x crashes on Java 9+ module-info / multi-release entries in the library jars: dex stripped copies.
$dexLibs = foreach ($l in $libs) {
    $copy = "$out\$(Split-Path $l -Leaf)"
    Copy-Item $l $copy
    $z = [IO.Compression.ZipFile]::Open($copy, 'Update')
    @($z.Entries | Where-Object { $_.FullName -match 'module-info\.class$|^META-INF/versions/' }) | ForEach-Object { $_.Delete() }
    $z.Dispose()
    $copy
}
$classes = @(Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object FullName)
# The .bat wrappers split paths with spaces ("VS Code Works"), so run the jars directly.
java -cp "$bt\lib\d8.jar" com.android.tools.r8.D8 --debug --min-api 26 --lib $jar --output $out @classes @dexLibs
if ($LASTEXITCODE) { throw 'd8 failed' }

$zip = [IO.Compression.ZipFile]::Open("$out\base.apk", 'Update')
[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$out\classes.dex", 'classes.dex')
$zip.Dispose()

& "$bt\zipalign.exe" -f -p 4 "$out\base.apk" "$out\aligned.apk"
# Android's standard debug keystore (well-known test password), same key Gradle signs debug builds with.
java -jar "$bt\lib\apksigner.jar" sign --ks $ks --ks-pass pass:android --key-pass pass:android `
    --ks-key-alias androiddebugkey --out "$out\lyricdock.apk" "$out\aligned.apk"
if ($LASTEXITCODE) { throw 'apksigner failed' }
Write-Host "built $out\lyricdock.apk"
