# MangaLens TR kurulum paketi

Bu klasör, MangaLens TR uzantısının Windows 10/11 için tek dosyalı kurulum paketini ve paketi yeniden üretmek için gereken yapılandırmaları içerir.

## Hazır kurulum dosyası

`MangaLensTR-3.1.0.exe`

Yanındaki `MangaLensTR-3.1.0.bat`, aynı sürüm kurulum dosyasını kendi klasöründen başlatır ve verilen komut satırı argümanlarını iletir.

Kurulum dosyası uzantıyı kullanıcının şu klasörüne yerleştirir:

`%LOCALAPPDATA%\Programs\MangaLens TR\Extension`

Kurulum sırasında masaüstü ve Başlat menüsü kısayolları ayrı ayrı seçilebilir. Kısayol, Chrome, Edge, Brave, Vivaldi veya Opera için geliştirici modu yükleme adımlarını gösteren yardımcı uygulamayı açar.

> Windows'taki Chromium tarayıcı güvenlik kuralları nedeniyle mağaza dışında dağıtılan uzantı otomatik olarak etkinleştirilemez. Kullanıcı, tarayıcının uzantılar sayfasında **Geliştirici modu > Paketlenmemiş öğe yükle** adımlarını bir kez tamamlamalıdır.

## Paketi yeniden oluşturma

Derleme bilgisayarında şunlar gereklidir:

- Windows 10 veya Windows 11
- Node.js (`node.exe` komutu erişilebilir olmalı)
- [Inno Setup 6](https://jrsoftware.org/isdl.php)
- Windows ile gelen .NET Framework 4.x C# derleyicisi

PowerShell'i proje ana dizininde açıp çalıştırın:

```powershell
.\setup\build.ps1 -Clean
```

Betik:

1. `manifest.json` içinden sürümü okur.
2. Manifesti, gerekli klasörleri ve JavaScript sözdizimini doğrular.
3. Kurulum yardımcısını ve kurulum simgesini `setup` altında derler.
4. Inno Setup ile `setup\MangaLensTR-<sürüm>.exe` dosyasını üretir.
5. Aynı sürüm adına sahip `setup\MangaLensTR-<sürüm>.bat` başlatıcısını oluşturur ve hedefini doğrular.

## Başka projelere uyarlama

- `MangaLensTR.iss` içindeki uygulama adı, `AppId`, hedef klasör ve `[Files]` girdilerini değiştirin.
- `build.ps1` içindeki beklenen manifest adı ile doğrulanacak dosya listesini güncelleyin.
- `BrowserSetupHelper.cs` içindeki başlıkları, yönergeleri ve desteklenen tarayıcı listesini ihtiyaca göre düzenleyin.
- Her proje için yeni ve sabit bir Inno Setup `AppId` GUID değeri kullanın.
- Uygulama sürümünü manifestte artırın; kurulum dosyasının adı otomatik olarak yeni sürümü kullanır.

## Güncelleme ve kaldırma

Yeni sürüm aynı hedef klasördeki uzantı dosyalarını günceller. Geliştirici moduyla yüklenen uzantının yeni dosyaları kullanması için tarayıcının uzantılar sayfasındaki **Yeniden yükle** düğmesine basın.

Windows kaldırıcı dosyaları ve oluşturulan kısayolları siler. Tarayıcıda görünen geliştirici modu uzantısı, ilgili tarayıcının uzantılar sayfasından ayrıca kaldırılmalıdır.
