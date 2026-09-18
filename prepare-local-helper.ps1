[CmdletBinding()]
param([string]$Python)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
if (-not $Python) {
    $candidate = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($candidate) { $Python = $candidate.Source }
    else { $candidate = Get-Command 'python.exe' -ErrorAction SilentlyContinue; if ($candidate) { $Python = $candidate.Source } }
}
if (-not $Python) { throw 'Python 3.12 bulunamadı. -Python parametresiyle Python yolunu verin.' }
$venv = Join-Path $root '.hermes\venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venv)) {
    if ([IO.Path]::GetFileName($Python) -ieq 'py.exe') { & $Python -3.12 -m venv (Join-Path $root '.hermes\venv') }
    else { & $Python -m venv (Join-Path $root '.hermes\venv') }
    if ($LASTEXITCODE -ne 0) { throw 'Python sanal ortamı oluşturulamadı' }
}
& $venv -m pip install --disable-pip-version-check -r (Join-Path $root 'requirements-local.txt')
if ($LASTEXITCODE -ne 0) { throw 'Yerel bağımlılıklar yüklenemedi' }
$dir = Join-Path $root '.hermes\models'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$model = Join-Path $dir 'detector_int8.onnx'
if (-not (Test-Path -LiteralPath $model -PathType Leaf)) {
    Invoke-WebRequest -Uri 'https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/3aedf6d/detector_int8.onnx' -OutFile $model
}
$expected = 'B5022AD46416B6FE4F88B0CC082CFD2FF5B1CFC624088C2F19879485493F5913'
if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash -ne $expected) { throw 'İndirilen model sağlama toplamı uyuşmuyor' }
$ocr = @(
    @{ Name='ocr_det.onnx'; Url='https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx'; Hash='4D97C44A20D30A81AAD087D6A396B08F786C4635742AFC391F6621F5C6AE78AE' },
    @{ Name='ocr_rec.onnx'; Url='https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx'; Hash='C3461ADD59BB4323ECBA96A492AB75E06DDA42467C9E3D0C18DB5D1D21924BE8' },
    @{ Name='ocr_cls.onnx'; Url='https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx'; Hash='E47ACEDF663230F8863FF1AB0E64DD2D82B838FCEB5957146DAB185A89D6215C' }
)
foreach ($item in $ocr) {
    $path = Join-Path $dir $item.Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Invoke-WebRequest -Uri $item.Url -OutFile $path }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $item.Hash) { throw "OCR model sağlama toplamı uyuşmuyor: $($item.Name)" }
}
Write-Host 'Yerel yardımcı geliştirme ortamı hazır.' -ForegroundColor Green
