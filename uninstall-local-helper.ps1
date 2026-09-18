[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$expected = Join-Path $root 'native\com.mangalens.tr.json'
$keys = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mangalens.tr',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.mangalens.tr',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mangalens.tr'
)
$removed = 0
foreach ($key in $keys) {
    if (-not (Test-Path -Path $key)) { continue }
    $actual = (Get-Item -Path $key).GetValue('')
    if ($actual -ne $expected) { continue }
    Remove-Item -Path $key
    $removed++
}
if ($removed) { Write-Host "$removed yerel yardımcı kaydı kaldırıldı." -ForegroundColor Green }
else { Write-Host 'Bu paket için kayıt bulunamadı.' }
