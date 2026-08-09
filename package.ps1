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
    'popup\style.css',
    'src\background.js',
    'src\content.js'
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
foreach ($relativePath in @('popup\popup.js', 'src\background.js', 'src\content.js')) {
    & $node.Source --check (Join-Path $projectRoot $relativePath)
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript sözdizimi doğrulaması başarısız: $relativePath"
    }
}

$packageName = "MangaLensTR-$version.zip"
$packagePath = Join-Path $projectRoot $packageName
if (Test-Path -LiteralPath $packagePath) {
    Remove-Item -LiteralPath $packagePath -Force
}

$archiveInputs = @(
    (Join-Path $projectRoot 'manifest.json'),
    (Join-Path $projectRoot 'assets'),
    (Join-Path $projectRoot 'popup'),
    (Join-Path $projectRoot 'src')
)
Compress-Archive -LiteralPath $archiveInputs -DestinationPath $packagePath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($requiredEntry in @('manifest.json', 'assets/icon16.png', 'assets/icon48.png', 'assets/icon128.png', 'popup/popup.html', 'popup/popup.js', 'popup/style.css', 'src/background.js', 'src/content.js')) {
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
