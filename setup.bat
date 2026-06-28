@echo off
REM dosya: setup.bat
REM MangaLens TR — Gerekli kutuphaneleri indir (Windows)
REM Bu dosyayi mangalens-tr klasorunde cift tiklayin

echo MangaLens TR - Kutuphaneler indiriliyor...
echo.

if not exist "lib" mkdir lib

echo [1/2] Tesseract.js ana dosyasi indiriliyor...
powershell -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js' -OutFile 'lib\tesseract.min.js'"

echo [2/2] Tesseract.js worker dosyasi indiriliyor...
powershell -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js' -OutFile 'lib\tesseract.worker.min.js'"

echo [3/3] Tesseract.js WASM core dosyasi indiriliyor...
powershell -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js' -OutFile 'lib\tesseract-core.wasm.js'"

echo.
echo Dosya boyutlari kontrol ediliyor...
dir lib\*.js

echo.
echo =============================================
echo  Kurulum tamamlandi!
echo  Simdi Chrome'da chrome://extensions adresi
echo  acin ve eklentiyi yeniden yukleyin.
echo =============================================
pause
