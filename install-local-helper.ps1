[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Chrome uzantı kimliği 32 küçük a-p harfi olmalıdır.' }
$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$exe = Join-Path $root "native\MangaLensTR-$version.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Yardımcı bulunamadı: $exe" }
$test = & $exe --self-test | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $test.ok -or -not $test.model) { throw 'Yardımcı veya balon modeli çalışmıyor.' }

$hostManifest = Join-Path $root 'native\com.mangalens.tr.json'
$manifest = @{
    name = 'com.mangalens.tr'
    description = 'MangaLens TR yerel balon tespiti'
    path = $exe
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
[System.IO.File]::WriteAllText($hostManifest, ($manifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
$keys = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mangalens.tr',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.mangalens.tr',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mangalens.tr'
)
foreach ($key in $keys) {
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $hostManifest
}
Write-Host "Yerel yardımcı kaydedildi: $ExtensionId" -ForegroundColor Green
