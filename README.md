# MangaTranslate (MangaLens TR) — English-to-Turkish manga bubble translation

> Türkçe için: [README.tr.md](./README.tr.md)

Chrome Manifest V3 extension. Translates English speech bubbles on manga/manhwa/manhua sites into Turkish with the Gemini API — region select, one-click whole-page mode, auto-translate, retry variants, and a rate-limited queue.

![MangaTranslate screenshots](./docs/screenshots/)

> Screenshots are being added from a clean install (no sample data). The folder above will hold them.

## Install

1. Extract `MangaLensTR-3.2.0.zip`.
2. `chrome://extensions` → Developer mode → Load unpacked (folder with `manifest.json`).
3. Popup → API tab → add at least one Gemini key, test, activate.
4. On a page: Page Translate / Select Area / Auto Translate.

Packaging: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1` (reads version from manifest, validates MV3 + JS, zips the 12 required files).

## Features

- **Page mode (one button)** — translates the visible page first, then keeps going as you scroll (or the whole chapter); every bubble gets a Turkish overlay box with auto-fitted text, the English original on hover, and results cached per page.
- **Region select** — draw up to 12 areas (min 24px), Enter translates in batch.
- **Auto translate** — every drawn area translated without waiting.
- **Retry variants** — `Retry` re-reads the image without sending the previous result; 3 strategies (casual tone / tone-emotion-context / short-bubble fit), high creativity on the fallback model.
- **Result tools** — `Retry` + `×` on every result box.
- **Font size** — 16px / 20px applied to all results (`chrome.storage.sync`).
- **Multiple keys** — add/test/activate Gemini keys (`chrome.storage.local`).
- **Model choice** — `gemini-3.5-flash-lite` default / `gemini-3.1-flash-lite`; one fallback retry on 3.5 failure.
- **Resilient capture** — the original image is fetched by the service worker (no CORS limits), canvas readers are read directly, visible-tab crop is the last resort.
- **Request queue** — min 6 s interval, 30→120 s backoff on 429/timeouts (network errors fail fast), 45 s timeout, keepalive alarm.
- **Stats** — per-minute/day/total success counters, local only.

## Project structure

```text
manifest.json         MV3 (<all_urls> + generativelanguage host)
src/background.js     Gemini API, prompts, queue/rate-limit, keys, page cache
src/content.js        area select, auto translate, capture, result boxes
src/pagemode-core.js  page-mode math (bands, dedupe, coordinates) — shared with SW + node tests
src/pagemode.js       page mode: scan, image acquire, overlay, progress pill
styles/pagemode.css   page-mode styles
popup/popup.html      Translate/API tabbed UI
popup/popup.js        mode/preference/stats/key management
popup/style.css
assets/               icons 16/48/128
tests/                node --test suites (pure logic)
package.ps1           packaging script
```

## Tests

```bash
node --test tests/*.test.js
```

## Contributing

Small PRs, no API keys in code or fixtures. See [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md).

## License

See [LICENSE](./LICENSE) (pending — to be confirmed).
