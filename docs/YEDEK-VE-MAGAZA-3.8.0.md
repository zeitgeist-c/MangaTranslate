# 3.8.0 çalışan sürüm yedeği ve mağaza hazırlığı

13 Ekim 2026. Kullanıcının gerçek denemesi: Muse Spark Contributor, 24/24 görsel,
152 kart, 87 kontrol alanı, 0 hata; 93,3 saniye gerçek süre; 10 başarılı grup.
Bu kullanıcı gözlemidir; tüm metinlerin eksiksiz bulunduğunun veya çevirilerin
anlam doğruluğunun bağımsız kanıtı değildir. 353,3 saniye paralel istek sürelerinin
toplamıdır. Hız hedefi bu denemede sağlanmıştır.

Çalışan uygulama commit'i: `37bcc15d5eb68ccca9db39231de3acd692a9893c`, etiket `v3.8.0`.
Paket SHA-256: `b8209689fc9a0c0b58cdc101ccc9d9c112c61b0d11efddc1d7becbeec77c80ac`.
Bu hazırlık sürüm numarasını veya dağıtım paketini değiştirmez.

## Yeni checkpoint

Hedef: `.rollback/2026-10-13-3.8.0-live-validated/`.
Kaynak ve dağıtım arşivleri ayrı `source/` ve `distribution/` dizinlerinde
`MangaLensTR-3.8.0.zip` adını kullanır. `repository.bundle` yerel Git geçmişidir.
`checkpoint.json` kaynak dosyası hash'lerini ve gerçek geri açma kontrolünü kaydeder.
Kaynak yedeği Git'te izlenen dosyaları kapsar. İlgisiz izlenmeyen kullanıcı WIP'si
orijinal çalışma alanında korunur; yedeklenmiş gibi sunulmaz.

`brave-extension-storage.dpapi` yalnız ilgili uzantının Local/Sync Extension Settings
ve IndexedDB verilerini içerir. Açık metin anahtar dışa aktarımı yapılmaz.
Şifre çözme aynı Windows kullanıcısına/makinesine bağımlıdır; profil/hesap silinirse
bu yedek kullanılamayabilir. Dosya yalnız bu diskteyse disk kaybına karşı koruma değildir.
Tüm tarayıcı geçmişi, çerezler, oturumlar ve açık sekmeler bu yedeğe dahil değildir.

## Geri dönüş

1. Brave'i tamamen kapatın; mevcut verileri ayrıca yedekleyin.
2. `checkpoint.json` ve şifreli depolama yanındaki JSON hash'lerini doğrulayın.
3. Kaynak ZIP'ini **yeni** klasöre açın; mevcut proje üzerine körlemesine yazmayın.
4. Kod geri dönüşünde güncel profil verilerini varsayılan olarak koruyun.
5. Profil verisini de geri almak gerçekten gerekiyorsa DPAPI arşivini aynı Windows
   hesabıyla bellekte çözün. Arşivdeki göreli yolları doğrulayıp yalnız kayıtlı
   uzantı kimliğine ait Local/Sync/IndexedDB dizinlerini geri yükleyin. Mevcut dizinleri
   önce ayrı saklayın; LevelDB dosyalarını eski/yeni karıştırmayın.
6. Brave'de uzantıyı yeniden yükleyin; anahtarların maskeli listesini, tercihleri ve
   saklı iş sonuçlarını kontrol edin. Yeni ücretli çeviri otomatik başlatılmamalı.

Kaynak dosyaları fiziksel olarak geri açılıp hash'leri karşılaştırılır; profil
şifreleme/çözme ve her arşiv girdisi bellekte doğrulanır. Bu kontrol tek başına
tarayıcıda tam işlevsel profil geri dönüşü veya canlı API testi anlamına gelmez.
Gerçek yapılan kontroller checkpoint kayıtlarında ayrıca belirtilir.

3.1.7 ilk geri dönüş noktası ve önceki sürüm paketleri korunur. Mağaza adımları
`store/PUBLISH.md`, açıklama `store/LISTING-TR.md`, gizlilik taslağı `store/PRIVACY-TR.md`.
Dağıtım **Unlisted**; mağaza görselleri `store/assets/` içinde hazırdır.
Herkese açık HTTPS gizlilik adresi tamamlanmadan incelemeye hazır sayılmaz.
Henüz mağazaya gönderilmiş değildir.
