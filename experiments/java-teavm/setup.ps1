param([string]$JdkPath = 'C:/Program Files/Java/jdk-25')
$ErrorActionPreference = 'Stop'
$experiment = $PSScriptRoot
$generated = Join-Path $experiment 'generated'
$revision = 'cf274939233f390b4bc92413c2b057ab14c323d3'
$buildCache = Join-Path ([System.IO.Path]::GetTempPath()) "tankscript-teavm-$revision"
$lock = Get-Content -LiteralPath (Join-Path $experiment 'asset-lock.json') -Raw | ConvertFrom-Json
function Check-Hash([string]$File, [string]$Expected) {
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw "Checksum mismatch: $File"
    }
}
New-Item -ItemType Directory -Force $generated | Out-Null
New-Item -ItemType Directory -Force $buildCache | Out-Null
$archive = Join-Path $buildCache 'teavm-javac.zip'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest "https://codeload.github.com/konsoletyper/teavm-javac/zip/$revision" -OutFile $archive
}
Check-Hash $archive $lock.sourceArchiveSha256
$source = Join-Path $buildCache "teavm-javac-$revision"
if (!(Test-Path -LiteralPath $source)) { Expand-Archive -LiteralPath $archive -DestinationPath $buildCache }
# This upstream revision references a missing Checkstyle version even for non-lint builds.
$catalog = Join-Path $source 'gradle/libs.versions.toml'
$text = Get-Content -LiteralPath $catalog -Raw
if (!$text.Contains('checkstyle =')) {
    Set-Content -LiteralPath $catalog -Value $text.Replace('[versions]', "[versions]`ncheckstyle = `"10.21.4`"") -NoNewline
}
# Backport the official SDK metadata fix, adapted to the 0.16.0 ArchiveBuilder location.
$converter = Join-Path $buildCache 'StdlibConverter.upstream.java'
if (!(Test-Path -LiteralPath $converter)) {
    Invoke-WebRequest 'https://raw.githubusercontent.com/konsoletyper/teavm-javac/76b5b53850f74e510ec8588a56a211cf60e9d496/compiler/src/main/java/org/teavm/javac/StdlibConverter.java' -OutFile $converter
}
Check-Hash $converter '3fab147e1fc8a5e4dad16dd7ca1ccaa84b265e213f3f8cd4fb6e3be579ccf6ac'
$converterText = (Get-Content -LiteralPath $converter -Raw).Replace('import org.teavm.compiler.bootstrap.tools.ArchiveBuilder;', '')
$converterTarget = Join-Path $source 'compiler/src/main/java/org/teavm/javac/StdlibConverter.java'
[System.IO.File]::WriteAllText($converterTarget, $converterText + "`n// TankScript experiment: official SDK fix backported; ArchiveBuilder import adapted.`n")
# Keep the developer build in one JVM instead of the upstream RMI build helper.
$compilerBuild = Join-Path $source 'compiler/build.gradle'
$buildText = (Get-Content -LiteralPath $compilerBuild -Raw).Replace('outOfProcess = true', 'outOfProcess = false')
[System.IO.File]::WriteAllText($compilerBuild, $buildText)
$wrapper = Join-Path $source 'gradle/wrapper/gradle-wrapper.properties'
$wrapperText = Get-Content -LiteralPath $wrapper -Raw
if (!$wrapperText.Contains('distributionSha256Sum=')) {
    Add-Content -LiteralPath $wrapper -Value "`ndistributionSha256Sum=a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806"
}
$jdkArchive = Join-Path $source 'javac/build/jdk-6c48f4ed707bf0b15f9b6098de30db8aae6fa40f.zip'
New-Item -ItemType Directory -Force (Split-Path $jdkArchive) | Out-Null
if (!(Test-Path -LiteralPath $jdkArchive)) {
    Invoke-WebRequest 'https://github.com/openjdk/jdk25u/archive/6c48f4ed707bf0b15f9b6098de30db8aae6fa40f.zip' -OutFile $jdkArchive
}
Check-Hash $jdkArchive $lock.jdkArchiveSha256
$env:JAVA_HOME = (Resolve-Path -LiteralPath $JdkPath).Path
$env:GRADLE_USER_HOME = Join-Path $buildCache 'gradle-cache'
Push-Location $source
try {
    & ./gradlew.bat :compiler:createDist --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m'
    if ($LASTEXITCODE -ne 0) { throw 'TeaVM toolchain build failed' }
} finally { Pop-Location }
$dist = Join-Path $source 'compiler/build/distributions/dist.zip'
$assets = Join-Path $generated 'assets'
Expand-Archive -LiteralPath $dist -DestinationPath $assets -Force
& node (Join-Path $experiment 'normalize-classlibs.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Class library normalization failed' }
& node (Join-Path $experiment 'verify-assets.mjs') --record-build
if ($LASTEXITCODE -ne 0) { throw 'Built assets differ from the reviewed asset lock' }
& node (Join-Path $experiment 'prepare-csp-runtime.mjs') --inventory
if ($LASTEXITCODE -ne 0) { throw 'CSP loader preparation failed' }
& node (Join-Path $experiment 'verify-assets.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Prepared CSP runtime verification failed' }
Write-Output "Toolchain assets: $assets"
