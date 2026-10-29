# MangaLens TR — Turkish translation for manga pages

> Türkçe: [README.tr.md](./README.tr.md)

**Read manga in Turkish. Select a region, or translate the whole chapter.**

MangaLens TR is a Brave/Chromium Manifest V3 extension that finds the English text in manga, manhwa and manhua pages, translates it to Turkish through Gemini, OpenRouter or Ollama, and paints the Turkish text back into the bubble.

Text detection runs locally. Only the crops you choose are sent to the provider you selected.

![MangaLens TR · Popup](./docs/screenshots/01-popup-gemini.png)

---

## Contents

- [What it does](#what-it-does)
- [Screens, one by one](#screens-one-by-one)
  - [1. Popup — Gemini](#1-popup--gemini)
  - [2. Popup — OpenRouter](#2-popup--openrouter)
  - [3. Settings — API keys](#3-settings--api-keys)
  - [4. Settings — Translation preferences](#4-settings--translation-preferences)
  - [5. Settings — About](#5-settings--about)
- [Install](#install)
- [How a translation runs](#how-a-translation-runs)
- [Providers and keys](#providers-and-keys)
- [Where your data lives](#where-your-data-lives)
- [Build from source](#build-from-source)
- [Known limits](#known-limits)
- [License](#license)

---

## What it does

| Capability | Detail |
|---|---|
| **Region select** | drag a box over any text and get the Turkish version in place |
| **Auto translate** | detect the page's text blocks and translate them in one pass |
| **Whole chapter** | scan the reader page, translate every bubble, place the result inside the safe area |
| **Three providers** | Gemini (direct), OpenRouter, or a local Ollama instance — per-provider key lists |
| **Key rotation** | requests walk the saved keys in order; a key that returns 429 or hits its quota is rested and the next one is used |
| **Provider failover** | on Gemini 429/503 the next model in the list is tried automatically; other transient errors chain only when you opt in |
| **Term dictionary** | your own names and terms keep their Turkish spelling across pages |
| **Translation cache** | repeated crops reuse the stored result instead of paying for it twice |
| **Local detection** | text regions are found on your machine, no upload for detection |

---

## Screens, one by one

### 1. Popup — Gemini

![Popup · Gemini](./docs/screenshots/01-popup-gemini.png)

The toolbar popup, 360 px wide.

**Header** — logo and name, the on/off switch for the extension, and the gear that opens Settings.

**Provider tabs** — `Gemini`, `OpenRouter`, `Ollama`. Each tab keeps its own model and key list; switching provider does not lose the others.

**Translation model** — the model list for the selected provider, with the active choice highlighted. Under it, a key summary shows how many keys are registered and whether the active one is usable (`2 anahtar kayıtlı`).

**Actions**
- `Bölümün tamamını çevir` — the whole-chapter path: scan the page, translate every block, place the text.
- `Alan Seç` — drag a box on the page and translate only that.
- `Oto Çevir` — automatic detection and translation of the page's text blocks.

The note under the buttons is deliberate: *"Tam bölüm önizleme · Belirsiz alanlar kontrol gerektirir."* Whole-chapter is a preview feature — text that could not be identified with confidence is left for you to check instead of being painted over.

**Usage counters** — minute, today, total. They count requests actually sent; cache hits and skipped blocks do not inflate them.

### 2. Popup — OpenRouter

![Popup · OpenRouter](./docs/screenshots/02-popup-openrouter.png)

The same popup with the OpenRouter tab active. The model list changes to OpenRouter's catalogue (`gpt-6-luna` default, with `gemma-4-26b` and `muse-spark-1.3` as alternatives), and the key summary reflects that provider's own keys.

Each provider is independent: a Gemini key never appears under OpenRouter and vice versa.

Ollama works the same way against a local endpoint — no cloud key, no request leaving the machine.

### 3. Settings — API keys

![Settings · API keys](./docs/screenshots/03-ayarlar-anahtarlar.png)

Three sections in the left rail: **API Anahtarları**, **Çeviri Tercihleri**, **Hakkında**.

Under API keys, one tab per provider, each with its own key ring:

- **Add a key** — a label plus the key itself.
- The first key added becomes active automatically; you choose which of the rest is active.
- Keys are stored in this browser only.

`Kontrol et` checks the connection without producing a translation. The note under it is honest about what that means: a successful check does not prove the model is enabled for the account or that any age verification is complete.

### 4. Settings — Translation preferences

![Settings · Translation preferences](./docs/screenshots/04-ceviri-tercihleri.png)

**Reading and scanning**
- **Content type** — `Otomatik / bilinmiyor`, `Manga`, `Manhwa`, `Manhua`. It tunes how bubbles are expected to look.
- **Local scan mode** — `Hızlı yazı taraması (önerilen)`, `Alternatif balon taraması`, `Ayrıntılı balon taraması (yavaş)`. Fast is the default; detailed trades time for recall.
- **Translation font size** — `Normal` or `Büyük`.
- **Series name** — optional context that helps the model keep character and series names consistent.

**Language and terms**
- **Translation instruction** — your own style or tone direction.
- **Name and term dictionary** — source term equals Turkish equivalent, applied across pages.

**Provider behaviour**
- *"Gemini 429/503'te her zaman sonraki modele otomatik geçer."* On these two codes the chain always moves on. When enabled, other transient errors (500/502/504) chain too; when disabled, the job stops on them instead of silently switching model.

`Kaydet` writes the changes; `Değişiklik yok` shows when nothing is pending.

### 5. Settings — About

![Settings · About](./docs/screenshots/05-hakkinda.png)

The version, what the extension does, and the honest note about whole-chapter being a preview whose text recall is not yet verified against human labels.

It also states the data flow plainly:

- detection runs locally,
- only the crops you send go to your chosen provider,
- keys and job records stay local, preferences live in browser sync storage, the translation cache lives in IndexedDB.

`Model kataloğunu kontrol et` refreshes the model list from the provider.

---

## Install

Release package: `MangaLensTR-3.9.5.zip`.

The extension is loaded unpacked from source:

1. Open `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. `Load unpacked` and pick the repository folder (the one containing `manifest.json`).
4. Open the popup, go to Settings, and add at least one API key.

## How a translation runs

1. **Detect** — the page's text regions are found locally.
2. **Crop** — each region is cut out as an image.
3. **Send** — the crops go to the selected provider with the model and your instruction.
4. **Verify** — the response is checked; a block whose answer cannot be tied to a region is not painted.
5. **Place** — the Turkish text is drawn inside the bubble's safe area, at the font size you chose.
6. **Cache** — the result is stored so the same crop is not sent twice.

Parallelism adapts: Gemini opens one lane per key (max 4) with 2.5 s spacing per key and 12 requests per key per minute; OpenRouter ramps 4 → 6 → 8 concurrent requests. When every key is exhausted the job waits for the window to end and continues automatically instead of failing.

## Providers and keys

| Provider | Needs | Notes |
|---|---|---|
| **Gemini** | a Google AI Studio key | direct path, no aggregator in between |
| **OpenRouter** | an OpenRouter key | one key reaches many model families |
| **Ollama** | a local Ollama server | nothing leaves the machine |

Keys per provider are stored as a list. Requests walk the list in order, each key serving up to its concurrency limit, then wrap around. A key that returns 429 or burns its quota is rested for a while and skipped.

## Where your data lives

| What | Where |
|---|---|
| API keys | this browser only (extension local storage) |
| Preferences | browser sync storage |
| Term dictionaries, job records | local |
| Translation cache | IndexedDB |

No analytics, no account, no telemetry server. The only outbound traffic is the crop you send to the provider you chose — and with Ollama, nothing leaves the machine at all.

## Build from source

There is no build step: the extension is plain HTML/CSS/JS loaded unpacked. To work on it:

1. Load the folder unpacked as above.
2. Edit the files under `popup/`, `options/`, `content/` (or `page/`).
3. Press the reload button on the extension card and refresh the manga page.

## Known limits

- **Whole-chapter is a preview.** Finding every text block and the ~98% quality target are not yet verified against human labels; uncertain regions are left for you to check.
- Detection is local and fast, but it can miss stylised lettering, text over busy art, or vertical text.
- A successful `Kontrol et` proves the key is accepted — not that the model is available to the account or that age verification is done.
- Translation quality depends on the model; the extension does not post-edit the model's Turkish.
- Free-tier keys hit rate limits; the rotation keeps working but a large chapter takes longer.

## License

MIT — see [LICENSE](./LICENSE).
