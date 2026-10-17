# MangaTranslate — DURUM (ortak — Desktop + Telegram okur)

**Güncelleme:** 2026-10-17
**Versiyon:** 3.9.4 (`MangaLensTR-3.9.4.zip`, tag v3.9.4, Release yayınlandı; mağaza gönderimi kullanıcı denemelerinden sonra)
**Branch:** v2-auto-page-translate
**Son commit:** bu kapanış (3.9.4: OpenRouter listesi sadeleşti; bekleme sonrası otomatik devam)
**Ağaç:** kapanış sonrası temiz hedef — `.hermes/` izlenmiyor (oturum planları)
**Not:** Branch main değil; paketleme `package.ps1` ile. Mağaza yayını Unlisted; 3.9.3 incelemede, 3.9.4 paketi kullanıcı denemelerinden sonra gönderilecek.

## Bu kapanış (2026-10-17, 3.9.4)
- OpenRouter kataloğu canlı uç denetimiyle sadeleşti: GPT-6 Luna (varsayılan), Gemma 4 26B, Muse Spark 1.3 Contributor. Çıkarıldı: qwen3.7/3.8, haiku-5.5, nemotron-3.5-super-vl, mimo-v2.6-flash, glm-5.3-flash, tüm `:free` modeller, gemma-4-31b-it, muse-spark-1.3 normal.
- `src/page-content.js`: `PROVIDER_COOLDOWN` otomatik devam listesine eklendi (notSent; ücret riski yok) — bekleme sayacı dolunca tarama kendiliğinden sürüyor.
- `src/providers.js`/`popup/ui.js`: varsayılan OpenRouter modeli GPT-6 Luna; Luna'da düşünme kapalı + katı bölge şeması, 90 sn bekçi, 2 eşzamanlı.
- Proto denemesi: Nemotron 3.5 Bolt OpenRouter'da yok (Ollama yerel modeli, 74B-A9B); eklenmedi.
- Doğrulama: 113/113 test; `package.ps1` kapısı geçti (`dist/MangaLensTR-3.9.4.zip`); zip↔kaynak denetimi.
- Mağaza belgeleri (`store/`) 3.8.6 gönderim setinde duruyor; 3.9.4 gönderiminden önce güncellenecek. 3.9.3 zip `dist/` içinde korunuyor.

## Önceki kapanış (2026-10-16, 3.9.3)
- İkinci bakış (kartsız bölgeler küçük gruplarla otomatik tekrar), Ollama anahtar başına tek uçuş, ölü yedek dalı temizliği. 134 test; tag v3.9.3 + Release + mağaza incelemesine gönderildi.

## Sırada
- Kullanıcı söyler.

## Bağımlılık (2026-09-26)
- Yok: harici JS bağımlılığı yok (hepsi yerel, CSP self-only). model.test.js geçiyor.
