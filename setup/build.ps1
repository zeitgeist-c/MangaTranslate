[CmdletBinding()]
param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$setupRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $setupRoot
$buildRoot = Join-Path $setupRoot 'build'
$assetsRoot = Join-Path $setupRoot 'assets'
$manifestPath = Join-Path $projectRoot 'manifest.json'
$issPath = Join-Path $setupRoot 'MangaLensTR.iss'
$helperSource = Join-Path $setupRoot 'BrowserSetupHelper.cs'
$helperOutput = Join-Path $buildRoot 'MangaLensTR-Kurulum-Yardimcisi.exe'
$iconOutput = Join-Path $assetsRoot 'MangaLensTR.ico'

function Assert-Path {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Gerekli dosya veya klasör bulunamadı: $Path"
    }
}

function Find-CSharpCompiler {
    $candidates = @(
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
    )
    $compiler = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $compiler) {
        throw '.NET Framework C# derleyicisi bulunamadı. Windows .NET Framework 4.x özelliğini etkinleştirin.'
    }
    return $compiler
}

function Find-InnoCompiler {
    $command = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe' }),
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        'C:\tmp\Inno Setup 6\ISCC.exe'
    ) | Where-Object { $_ }

    $compiler = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $compiler) {
        throw 'Inno Setup 6 bulunamadı. https://jrsoftware.org/isdl.php adresinden kurup betiği yeniden çalıştırın.'
    }
    return $compiler
}

function New-SetupIcon {
    param(
        [Parameter(Mandatory = $true)][string]$PngPath,
        [Parameter(Mandatory = $true)][string]$IcoPath
    )

    Add-Type -AssemblyName System.Drawing
    if (-not ('NativeIconMethods' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeIconMethods {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@
    }

    $source = [System.Drawing.Image]::FromFile($PngPath)
    $bitmap = $null
    $icon = $null
    $stream = $null
    $handle = [IntPtr]::Zero
    try {
        $bitmap = New-Object System.Drawing.Bitmap 128, 128
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.DrawImage($source, 0, 0, 128, 128)
        }
        finally {
            $graphics.Dispose()
        }
        $handle = $bitmap.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($handle)
        $stream = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create)
        $icon.Save($stream)
    }
    finally {
        if ($stream) { $stream.Dispose() }
        if ($icon) { $icon.Dispose() }
        if ($handle -ne [IntPtr]::Zero) { [void][NativeIconMethods]::DestroyIcon($handle) }
        if ($bitmap) { $bitmap.Dispose() }
        $source.Dispose()
    }
}

Write-Host 'MangaLens TR kurulum paketi hazırlanıyor...'

Assert-Path $manifestPath
Assert-Path $issPath
Assert-Path $helperSource
foreach ($required in @('assets', 'popup', 'src')) {
    Assert-Path (Join-Path $projectRoot $required)
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw 'Yalnızca Manifest V3 uzantıları destekleniyor.' }
if ($manifest.name -ne 'MangaLens TR') { throw "Beklenmeyen uygulama adı: $($manifest.name)" }
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw "Geçersiz manifest sürümü: $version" }

if ($Clean -and (Test-Path -LiteralPath $buildRoot)) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
New-Item -ItemType Directory -Path $assetsRoot -Force | Out-Null

$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
if (-not $node) { throw 'JavaScript sözdizimi doğrulaması için Node.js bulunamadı.' }
foreach ($script in @('src\background.js', 'src\content.js', 'popup\popup.js')) {
    $scriptPath = Join-Path $projectRoot $script
    Assert-Path $scriptPath
    & $node.Source --check $scriptPath
    if ($LASTEXITCODE -ne 0) { throw "JavaScript sözdizimi doğrulaması başarısız: $script" }
}

New-SetupIcon -PngPath (Join-Path $projectRoot 'assets\icon128.png') -IcoPath $iconOutput

$csc = Find-CSharpCompiler
& $csc /nologo /target:winexe /optimize+ /win32icon:$iconOutput /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /out:$helperOutput $helperSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $helperOutput)) {
    throw 'Tarayıcı kurulum yardımcısı derlenemedi.'
}

& $helperOutput --self-test $projectRoot
if ($LASTEXITCODE -ne 0) { throw "Kurulum yardımcısı öz testi başarısız (kod: $LASTEXITCODE)." }

$iscc = Find-InnoCompiler
& $iscc "/DMyAppVersion=$version" $issPath
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup derlemesi başarısız.' }

$releaseStem = "MangaLensTR-$version"
$installerPath = Join-Path $setupRoot "$releaseStem.exe"
$launcherPath = Join-Path $setupRoot "$releaseStem.bat"
Assert-Path $installerPath

$launcherContent = @"
@echo off
setlocal
cd /d "%~dp0"
start "$releaseStem" "%~dp0$releaseStem.exe" %*
"@
[System.IO.File]::WriteAllText($launcherPath, $launcherContent.Replace("`n", "`r`n"), [System.Text.UTF8Encoding]::new($false))
Assert-Path $launcherPath

$launcherText = Get-Content -LiteralPath $launcherPath -Raw -Encoding UTF8
if ($launcherText -notmatch [regex]::Escape("%~dp0$releaseStem.exe")) {
    throw "Başlatıcı doğru EXE dosyasına başvurmuyor: $launcherPath"
}

$unexpected = Get-ChildItem -LiteralPath $projectRoot -File -Filter 'MangaLensTR-*.exe'
if ($unexpected) {
    throw 'Kurulum çıktısı setup klasörü dışında bulundu.'
}

Write-Host ''
Write-Host 'Kurulum paketi başarıyla oluşturuldu:' -ForegroundColor Green
Write-Host $installerPath -ForegroundColor Green
Write-Host $launcherPath -ForegroundColor Green
