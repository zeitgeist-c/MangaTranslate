[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Geçersiz sürüm' }
$python = Join-Path $root '.hermes\venv\Scripts\python.exe'
$model = Join-Path $root '.hermes\models\detector_int8.onnx'
$expected = 'B5022AD46416B6FE4F88B0CC082CFD2FF5B1CFC624088C2F19879485493F5913'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'Yalıtılmış Python ortamı bulunamadı' }
if (-not (Test-Path -LiteralPath $model -PathType Leaf)) { throw 'Yerel model bulunamadı' }
if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash -ne $expected) { throw 'Model sağlama toplamı uyuşmuyor' }
$ocrModels = @{
    'ocr_det.onnx' = '4D97C44A20D30A81AAD087D6A396B08F786C4635742AFC391F6621F5C6AE78AE'
    'ocr_rec.onnx' = 'C3461ADD59BB4323ECBA96A492AB75E06DDA42467C9E3D0C18DB5D1D21924BE8'
    'ocr_cls.onnx' = 'E47ACEDF663230F8863FF1AB0E64DD2D82B838FCEB5957146DAB185A89D6215C'
}
foreach ($file in $ocrModels.Keys) {
    $path = Join-Path $root ".hermes\models\$file"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "OCR modeli bulunamadı: $file" }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $ocrModels[$file]) { throw "OCR model sağlama toplamı uyuşmuyor: $file" }
}

$name = "MangaLensTR-$version"
$outputRecord = Join-Path $root '.hermes\native-output.txt'
$dir = if (Test-Path -LiteralPath $outputRecord) { Get-Content -LiteralPath $outputRecord -Raw } else { Join-Path $root ".hermes\native-build\$name" }
$dir = $dir.Trim()
$exe = Join-Path $dir "$name.exe"
$sources = @('tools\native_host.py', 'tools\detector_pilot.py', 'build-local-helper.ps1') | ForEach-Object { Get-Item -LiteralPath (Join-Path $root $_) }
$rebuild = -not (Test-Path -LiteralPath $exe -PathType Leaf)
if (-not $rebuild) {
    $exeTime = (Get-Item -LiteralPath $exe).LastWriteTimeUtc
    $rebuild = @($sources | Where-Object { $_.LastWriteTimeUtc -gt $exeTime }).Count -gt 0
}
if ($rebuild) {
    $runId = [guid]::NewGuid().ToString('N')
    $dist = Join-Path $root ".hermes\native-build-$runId"
    $work = Join-Path $root ".hermes\pyinstaller-$runId"
    & $python -m PyInstaller --noconfirm --onedir --collect-data rapidocr --name $name --distpath $dist --workpath $work --specpath $work (Join-Path $root 'tools\native_host.py')
    if ($LASTEXITCODE -ne 0) { throw 'Yerel yardımcı derlenemedi' }
    $dir = Join-Path $dist $name
    $exe = Join-Path $dir "$name.exe"
}
$models = Join-Path $dir 'models'
New-Item -ItemType Directory -Path $models -Force | Out-Null
Copy-Item -LiteralPath $model -Destination (Join-Path $models 'detector_int8.onnx') -Force
foreach ($file in $ocrModels.Keys) {
    Copy-Item -LiteralPath (Join-Path $root ".hermes\models\$file") -Destination (Join-Path $models $file) -Force
}
$result = & $exe --self-test | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $result.ok -or -not $result.model -or -not $result.ocr) { throw 'Yerel yardımcı doğrulaması başarısız' }
[System.IO.File]::WriteAllText($outputRecord, $dir)
Write-Host "Yerel yardımcı hazır: $exe" -ForegroundColor Green
