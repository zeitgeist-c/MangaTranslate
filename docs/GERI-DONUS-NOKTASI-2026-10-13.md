# MangaLens TR — 13 Ekim 2026 geri dönüş noktası

Kullanıcının “geri dönüş noktasına dön” dediğinde kastettiği kayıt budur. Amaç, yeni geliştirmeden önceki çalışan 3.1.7 kaynak sürümüne dönmek ve kalıcı uzantı verilerini korumaktır. Bu kayıt yeni özellik uygulama onayı değildir.

## Kimlik

- Proje: `C:\Users\user\Projeler\MangaTranslate`
- Sürüm: `3.1.7`
- Branch: `v2-auto-page-translate`
- Kaynak commit: `7c64711f310fe4a88ed3e34226db2136590e44b0`
- Mevcut sürüm etiketi: `v3.1.7`
- Yeni yerel geri dönüş etiketi: `checkpoint/2026-10-13-before-page-mode`
- Brave profili: `Profile 3`
- Uzantı kimliği: `dpeaamihpojkamjniglllgmelcanpcom`
- Brave tercihlerindeki yükleme yolu yukarıdaki proje klasörüdür. Canlı uzantı arayüzündeki sürüm ayrıca doğrulanmadı.

## Yedekler ve doğrulama

Yedek dizini: `C:\Users\user\Projeler\MangaTranslate\.rollback\2026-10-13-before-page-mode`

| Dosya | Kapsam | Doğrulama |
|---|---|---|
| `MangaLensTR-3.1.7.zip` | 23 proje dosyasının anlık kopyası; izlenmeyen notlar ve mevcut dağıtım ZIP'i dahil; `.git` ve `.rollback` hariç | Ayrı `restored-workspace` dizinine açıldı; bütün dosya hash'leri eşleşti |
| `repository.bundle` | Yerel Git geçmişi ve referansları; checkpoint etiketi dahil | `git bundle verify` geçti |
| `checkpoint.json` | Dosya listesi, boyut/hash, commit ve kaynak doğrulama sonuçları | Kaynak arşivi için denetim manifesti |
| `verification.txt` | Bundle, sözdizimi ve test çıktısı | Üç JS kontrolü + iki test dosyası geçti |
| `brave-extension-storage.dpapi` | Yalnız bu uzantının local/sync kalıcı storage dosyaları | Brave kapalıyken alındı; şifre çözüldü ve 12 dosyanın hash'leri doğrulandı |
| `brave-storage.json` | Profil, kimlik, dosya hash'leri ve şifreleme bağımlılığı | Sır içeriklerini kaydetmez |

Kaynak anlık kopyası ZIP hash'i: `57ff4a8ad58376d92043195ecbc4292859cba1dce3b2125e3fc8cc1122df2f7a`.

Buradaki ZIP bir çalışma alanı yedeğidir; proje kökündeki aynı adlı dağıtım ZIP'inden farklıdır. Kökteki dağıtım paketi yedeğin içinde ayrıca korunmuştur. Yedek dizini uygulama paketine alınmamalıdır.

Storage yedeği Windows DPAPI CurrentUser ile şifrelidir; aynı Windows kullanıcısının profili ve makine korunmalıdır. Başka bilgisayara taşınabilir yedek değildir. API anahtarları düz metin arşive veya rapora yazılmadı.

Kaynak geri açma ve storage şifre çözme/dosya bütünlüğü denendi. **Canlı Brave profiline geri yükleme ve geri yüklenmiş uzantıyla gerçek çeviri denenmedi.** Oturumluk kuyruklar, geçici DOM balonları, açık sekmeler, tüm tarayıcı profili ve uzantı dışı veriler kapsamda değildir. Bu yedek aynı disktedir; disk arızasına karşı bağımsız kopya değildir.

## Çalışma ağacı

Başlangıçta izlenen uygulama dosyaları temizdi. Önceden bulunan izlenmeyen `.hermes/plans/2026-09-19_141538-sayfa-cevir-v2.md`, `AGENTS.md` ve `DURUM.md` kaynak ZIP'ine alındı. Yeni yedek araçları ve bu plan/kayıt belgeleri hazırlık çıktısıdır; uygulama kodu değildir. HEAD değişmedi, yeni sürüm commit'i veya push yapılmadı.

`checkpoint.json` içindeki `originalStatus` alanı yedek araçları üretildikten sonra alınmış Git durumunu içerir; yedek öncesi durumu bire bir temsil etmez. Asıl kaynak kapsamı `files` listesidir; başlangıçtaki üç izlenmeyen öğe yukarıda ayrıca kaydedilmiştir.

## “Geri dönüş noktasına dön” uygulama sırası

1. O andaki kaynak değişiklikleri, yeni dosyalar ve gerekiyorsa güncel uzantı verileri **yeni, ayrı bir kurtarma yedeğine** alınır. Yeni çalışmaları kaybetmeden dönmek ön koşuldur. Bu eski yedek üzerine yazılmaz.
2. Yukarıdaki arşiv ve bundle hash'leri manifestlerle kontrol edilir; kaynak arşivi yeniden ayrı dizine açılıp doğrulanır. Beklenmedik fark varsa işlem durdurulur.
3. Geçerli Git durumu ve diğer işlerin kapsamı incelenir. `git reset --hard` veya `git clean` körlemesine kullanılmaz. Git geçmişi korunur; gerekiyorsa eski commit'ten kurtarma branch'i açılır.
4. Doğrulanmış kaynak dosyaları aynı proje yoluna geri getirilir. Yalnız yeni özelliğe ait olduğu kayıtlı ek uygulama dosyaları, önce yedeklendikten sonra kaldırılır. İlgisiz kullanıcı dosyaları, `.rollback` ve planlar silinmez. İzlenmeyen başlangıç notları da arşivden korunur.
5. Manifest 3.1.7, kaynak hash'leri, üç JS sözdizimi kontrolü ve `node --test tests/geometry.test.js tests/model.test.js` doğrulanır. Paketleme script'i eski ZIP'i silebildiğinden sırf geri dönüş için çalıştırılmaz.
6. Brave'de aynı profil/uzantı kimliği ve yükleme yolu korunarak uzantı yeniden yüklenir. Uzantı kaldırılmaz; kaldırmak storage kaybına neden olabilir. Manuel çeviri, ayarlar ve anahtar listesi arayüzde kontrol edilir; anahtarlar loglanmaz.
7. Normal kaynak geri dönüşünde **o andaki** anahtarlar/ayarlar/istatistikler korunur. Ekim 13 storage yedeğiyle otomatik olarak üzerlerine yazılmaz. Yeni kazanılmış verileri kaybetmeden kodu geri almak varsayılan davranıştır.
8. Storage bozulmuşsa veya kullanıcı özellikle bu tarihteki ayarları istiyorsa: Brave tamamen kapatılır, mevcut storage ayrıca şifreli yedeklenir; DPAPI yedeği aynı kullanıcı altında çözülür ve yalnız kayıtlı uzantının local/sync dizinleri geri getirilir. Şifreli arşivin manifest hash'leri kontrol edilir, düz metin geçici içerik tutulmaz. Sync'in daha yeni bulut değerleriyle uzlaştırma ihtimali ve yeni anahtar/istatistik farkları değerlendirilir; körlemesine klasör üstüne karıştırma yapılmaz.
9. Brave açılıp yüklenen sürüm, kalıcı ayarlar, anahtarların kullanılabilirliği ve gerçek manuel çeviri doğrulanır. Bu canlı kontroller geçmeden “geri dönüş tamamlandı” denmez.

Tamamen başka Windows kurulumunda kurtarma gerekirse DPAPI dosyasının tek başına yeterli olduğu varsayılmaz. Böyle bir ihtiyaç için taşınabilir şifreli veri dışa aktarımı ayrı çalışma gerektirir.

## Hazırlık araçları

`.rollback/create_checkpoint.py` ve `.rollback/backup_brave.ps1` bu kaydı üretmek için hazırlanmıştır. Sabit tarihli kaynak helper'ı yeniden çalıştırılarak checkpoint güncellenmemelidir. Yeni tarihli kayıt ayrı dizine alınmalıdır; bu kayıt değişmez referans olarak tutulur.

İlgili uygulama önerisi: [Tam sayfa çeviri planı](TAM-SAYFA-CEVIRI-PLANI-2026-10-13.md).
