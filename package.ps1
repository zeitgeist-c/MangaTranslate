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
    'THIRD-PARTY-NOTICES.md',
    'assets\icon16.png',
    'assets\icon48.png',
    'assets\icon128.png',
    'popup\popup.html',
    'popup\popup.js',
    'popup\style.css',
    'src\background.js',
    'src\content.js',
    'src\pagemode-core.js',
    'src\local-match.js',
    'src\pagemode.js',
    'styles\pagemode.css',
    'install-local-helper.ps1',
    'uninstall-local-helper.ps1',
    'build-local-helper.ps1'
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
foreach ($relativePath in @('popup\popup.js', 'src\background.js', 'src\content.js', 'src\pagemode-core.js', 'src\local-match.js', 'src\pagemode.js')) {
    & $node.Source --check (Join-Path $projectRoot $relativePath)
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript sözdizimi doğrulaması başarısız: $relativePath"
    }
}

$packageName = "MangaLensTR-$version.zip"
$packagePath = Join-Path $projectRoot $packageName
if (Test-Path -LiteralPath $packagePath) {
    throw "Paket zaten mevcut; eski paket korunuyor: $packagePath"
}

& $node.Source --test (Join-Path $projectRoot 'tests\*.test.js')
if ($LASTEXITCODE -ne 0) { throw 'Paketleme öncesi testler başarısız.' }
$python = Join-Path $projectRoot '.hermes\venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'Yerel yardımcı için Python ortamı bulunamadı.' }
& $python -m unittest tests.test_detector_pilot -v
if ($LASTEXITCODE -ne 0) { throw 'Yerel yardımcı testleri başarısız.' }
& (Join-Path $projectRoot 'build-local-helper.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Yerel yardımcı derlenemedi.' }

$stage = Join-Path $projectRoot ('.hermes\package-stage-' + $version + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($relativePath in @('manifest.json', 'THIRD-PARTY-NOTICES.md', 'install-local-helper.ps1', 'uninstall-local-helper.ps1')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $stage
}
foreach ($relativePath in @('assets', 'popup', 'styles', 'src')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $stage -Recurse
}
$nativeSource = (Get-Content -LiteralPath (Join-Path $projectRoot '.hermes\native-output.txt') -Raw).Trim()
Copy-Item -LiteralPath $nativeSource -Destination (Join-Path $stage 'native') -Recurse
& $python (Join-Path $projectRoot 'tools\package_zip.py') $stage $packagePath
if ($LASTEXITCODE -ne 0) { throw 'Paket oluşturulamadı.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($requiredEntry in @('manifest.json', 'THIRD-PARTY-NOTICES.md', 'assets/icon16.png', 'assets/icon48.png', 'assets/icon128.png', 'popup/popup.html', 'popup/popup.js', 'popup/style.css', 'src/background.js', 'src/content.js', 'src/pagemode-core.js', 'src/local-match.js', 'src/pagemode.js', 'styles/pagemode.css', 'install-local-helper.ps1', 'uninstall-local-helper.ps1', "native/MangaLensTR-$version.exe", 'native/models/detector_int8.onnx', 'native/models/ocr_det.onnx', 'native/models/ocr_rec.onnx', 'native/models/ocr_cls.onnx')) {
        if ($entries -notcontains $requiredEntry) {
            throw "ZIP içinde gerekli dosya bulunamadı: $requiredEntry"
        }
    }
    if ($entries | Where-Object { $_ -match '\.(pem|key|p12|pfx)$' }) {
        throw 'ZIP paketi anahtar veya sertifika dosyası içeriyor.'
    }
    if ($entries | Where-Object { $_ -match '(^|/)(setup|\.git|\.hermes)(/|$)' -or ($_ -match '\.(exe|bat)$' -and $_ -ne "native/MangaLensTR-$version.exe") }) {
        throw 'ZIP paketi beklenmeyen geliştirme artığı içeriyor.'
    }
}
finally {
    $archive.Dispose()
}

Write-Host "ZIP paketi oluşturuldu: $packagePath" -ForegroundColor Green
