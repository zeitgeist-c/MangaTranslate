[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'manifest.json'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "manifest.json bulunamadı: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) {
    throw 'Yalnızca Manifest V3 uzantıları destekleniyor.'
}
if ($manifest.name -ne 'MangaLens TR') {
    throw "Beklenmeyen uzantı adı: $($manifest.name)"
}

$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Geçersiz manifest sürümü: $version"
}

$requiredFiles = @(
    'manifest.json',
    'assets\icon16.png',
    'assets\icon48.png',
    'assets\icon128.png',
    'popup\popup.html',
    'popup\popup.js',
    'popup\ui.js',
    'options\settings.html',
    'options\settings.js',
    'src\keys.js',
    'popup\style.css',
    'src\background.js',
    'src\content.js',
    'src\providers.js',
    'src\page-background.js',
    'src\page-content.js',
    'src\page\offscreen.html',
    'src\page\offscreen.mjs',
    'src\page\layout.mjs',
    'src\page\store.mjs',
    'src\page\lib\geometry.mjs',
    'src\page\lib\rtdetr.mjs',
    'src\page\lib\ppocr.mjs',
    'src\page\lib\db.mjs',
    'src\page\queue.js',
    'src\page\models\detector_int8.onnx',
    'src\page\models\ppocrv5_det.onnx',
    'src\page\models\detector-v4-s_int8.onnx',
    'src\page\vendor\ort.all.bundle.min.mjs',
    'src\page\vendor\ort-wasm-simd-threaded.jsep.mjs',
    'src\page\vendor\ort-wasm-simd-threaded.jsep.wasm',
    'src\page\licenses\ONNXRuntime-MIT.txt',
    'src\page\licenses\ONNXRuntime-ThirdPartyNotices.txt',
    'src\page\licenses\PaddleOCR-Apache-2.0.txt',
    'src\page\licenses\MODELS.md'
)

foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Gerekli uzantı dosyası bulunamadı: $relativePath"
    }
}

$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
if (-not $node) {
    throw 'JavaScript sözdizimi doğrulaması için Node.js bulunamadı.'
}
foreach ($relativePath in @('popup\popup.js', 'popup\ui.js', 'options\settings.js', 'src\keys.js', 'src\background.js', 'src\content.js', 'src\providers.js', 'src\page-background.js', 'src\page-content.js', 'src\page\offscreen.mjs', 'src\page\layout.mjs', 'src\page\queue.js', 'src\page\lib\db.mjs', 'src\page\lib\ppocr.mjs', 'src\page\store.mjs')) {
    & $node.Source --check (Join-Path $projectRoot $relativePath)
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript sözdizimi doğrulaması başarısız: $relativePath"
    }
}

$packageName = "MangaLensTR-$version.zip"
$packagePath = Join-Path $projectRoot $packageName
if (Test-Path -LiteralPath $packagePath) {
    throw "Önceki paket korunuyor; aynı sürümün üzerine yazılmaz: $packagePath"
}

& $node.Source --test (Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests') -File | Where-Object { $_.Name -match '\.test\.(js|mjs)$' } | ForEach-Object FullName)
if ($LASTEXITCODE -ne 0) { throw 'Sürüm testleri başarısız; paket oluşturulmadı.' }

$archiveInputs = @(
    (Join-Path $projectRoot 'manifest.json'),
    (Join-Path $projectRoot 'assets'),
    (Join-Path $projectRoot 'popup'),
    (Join-Path $projectRoot 'options'),
    (Join-Path $projectRoot 'src')
)
Compress-Archive -LiteralPath $archiveInputs -DestinationPath $packagePath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($requiredEntry in $requiredFiles) {
        $requiredEntry = $requiredEntry.Replace('\', '/')
        if ($entries -notcontains $requiredEntry) {
            throw "ZIP içinde gerekli dosya bulunamadı: $requiredEntry"
        }
    }
    if ($entries | Where-Object { $_ -match '(^|/)(setup|\.git)(/|$)' -or $_ -match '\.(exe|bat)$' }) {
        throw 'ZIP paketi kurulum veya geliştirme artığı içeriyor.'
    }
}
finally {
    $archive.Dispose()
}

Write-Host "ZIP paketi oluşturuldu: $packagePath" -ForegroundColor Green
