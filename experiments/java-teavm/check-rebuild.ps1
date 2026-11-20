param(
    [string]$JdkPath = 'C:/Program Files/Java/jdk-25'
)
$ErrorActionPreference = 'Stop'
$revision = 'cf274939233f390b4bc92413c2b057ab14c323d3'
$BuildCache = Join-Path ([IO.Path]::GetTempPath()) "tankscript-teavm-$revision"
$source = Join-Path $BuildCache "teavm-javac-$revision"
$lab = Join-Path $PSScriptRoot 'generated/repro-lab'
$lock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'asset-lock.json') -Raw | ConvertFrom-Json
$archive = Join-Path $BuildCache 'teavm-javac.zip'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.sourceArchiveSha256) { throw 'Source archive hash mismatch' }
New-Item -ItemType Directory -Force -Path $lab | Out-Null
# Restore the exact source archive, including any files aged out of the temp cache.
Expand-Archive -LiteralPath $archive -DestinationPath $BuildCache -Force
foreach ($name in @('setup.ps1', 'asset-lock.json', 'normalize-classlibs.mjs', 'verify-assets.mjs', 'prepare-csp-runtime.mjs', 'csp-runtime-support.js')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $lab $name)
}
# The isolated recipe writes generated/ inside this lab, never the reviewed asset folder.
$recipe = Get-Content -LiteralPath (Join-Path $lab 'setup.ps1') -Raw
$recipe = $recipe.Replace(':compiler:createDist --no-daemon', ':compiler:createDist --offline --rerun-tasks --no-build-cache -x :javac:unpackJDK --no-daemon')
$recipe = $recipe.Replace("'gradle-cache'", "'audit-gradle-cache'")
[IO.File]::WriteAllText((Join-Path $lab 'setup.ps1'), $recipe)
$auditCache = Join-Path $BuildCache 'audit-gradle-cache'
if (!(Test-Path -LiteralPath $auditCache)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $auditCache 'caches') | Out-Null
    # Reuse pinned downloads, not the old cache's incomplete generated transforms.
    Copy-Item -LiteralPath (Join-Path $BuildCache 'gradle-cache/wrapper') -Destination (Join-Path $auditCache 'wrapper') -Recurse
    Copy-Item -LiteralPath (Join-Path $BuildCache 'gradle-cache/caches/modules-2') -Destination (Join-Path $auditCache 'caches/modules-2') -Recurse
}
$env:JAVA_HOME = (Resolve-Path -LiteralPath $JdkPath).Path
$env:GRADLE_USER_HOME = Join-Path $BuildCache 'gradle-cache'
$jdkArchive = Join-Path $source 'javac/build/jdk-6c48f4ed707bf0b15f9b6098de30db8aae6fa40f.zip'
if ((Get-FileHash -LiteralPath $jdkArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.jdkArchiveSha256) { throw 'JDK source archive hash mismatch' }
# Restore only upstream's declared source inputs. Syncing the entire JDK/test tree
# is unnecessary; no Java source bytes are changed by this extraction optimization.
$jdkDestination = [IO.Path]::GetFullPath((Join-Path $source 'javac/build/jdk'))
$zip = [IO.Compression.ZipFile]::OpenRead($jdkArchive)
try {
    foreach ($entry in $zip.Entries) {
        if (!$entry.FullName.EndsWith('/') -and $entry.FullName -match '/make/langtools/tools/|/src/(jdk.compiler|java.compiler|jdk.internal.opt)/share/classes/') {
            if ($entry.FullName.EndsWith('/module-info.java')) { continue }
            $target = [IO.Path]::GetFullPath((Join-Path $jdkDestination $entry.FullName))
            if (!$target.StartsWith($jdkDestination + [IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe archive path' }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    }
} finally { $zip.Dispose() }
$results = @()
foreach ($iteration in 1..2) {
    $started = Get-Date
    & (Join-Path $lab 'setup.ps1') -JdkPath $JdkPath
    if ($LASTEXITCODE -ne 0) { throw 'Rebuild failed' }
    $output = Join-Path $PSScriptRoot "generated/rebuild-$iteration"
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $files = @{}
    foreach ($name in @('compiler.wasm', 'compiler.wasm-runtime.js', 'compiler.csp-runtime.js', 'compile-classlib-teavm.bin', 'runtime-classlib-teavm.bin')) {
        $file = Join-Path $lab "generated/assets/$name"
        $files[$name] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        Copy-Item -LiteralPath $file -Destination (Join-Path $output $name)
    }
    $results += @{ iteration = $iteration; seconds = ((Get-Date) - $started).TotalSeconds; files = $files }
}
$report = @{ measuredAt = (Get-Date).ToUniversalTime().ToString('o'); method = 'Two offline rerun-tasks builds, verified selective JDK source extraction, shared dependency downloads, fresh transforms, no Gradle build cache; separate output from reviewed assets'; builds = $results }
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'results/rebuild-check.json') -Encoding utf8
Write-Output 'Rebuild outputs preserved separately. Review hashes; working asset pins were not changed.'
