# MangaTranslate — DURUM (ortak — Desktop + Telegram okur)

**Güncelleme:** 2026-10-16
**Versiyon:** 3.9.1 (`MangaLensTR-3.9.1.zip`, tag v3.9.1, Release yayınlandı; yükseltme yok)
**Branch:** v2-auto-page-translate
**Son commit:** bu kapanış (mağaza metinleri; kod değişmedi, manifest 3.9.1 aynı)
**Ağaç:** kapanış sonrası temiz hedef — `.hermes/` izlenmiyor (oturum planları)
**Not:** Branch main değil; paketleme `package.ps1` ile. Mağaza yayını Unlisted.

## Bu kapanış (2026-10-16, Vibe Coding düzeltmeleri derlendi)
- `store/LISTING-TR.md`: açıklamaya 2 madde (anahtar başı 12 istek/dönüşümlü-paralel, sayfa paneli canlı akış).
- `store/PRIVACY-TR.md`: TR+EN yeniden yazım (veri kullanımı, yerel saklama, üçüncü taraflar, sınırlı kullanım).
- `store/PUBLISH.md`: gizlilik politikası URL'si + paket adı 3.8.6.
- Yeni: `store/STORE-FIELDS.md` (mağaza gönderim alan paketi), `AGENTS.md` (proje kuralları).
- Doğrulama: `node --test` 2/2 geçti; `node --check` (popup, background, content, page-content) temiz; manifest JSON geçerli 3.9.1; `dist/MangaLensTR-3.9.1.zip` içi manifest 3.9.1 — kod değişmediği için paket yeniden üretilmedi.
- Sürüm kararı kullanıcıdan alındı: yükseltme yok; yeni tag/Release açılmadı (v3.9.1 Release'i yayında).

## Sırada
- Kullanıcı söyler.

## Bağımlılık (2026-09-26)
- Yok: harici JS bağımlılığı yok (hepsi yerel, CSP self-only). model.test.js geçiyor.
