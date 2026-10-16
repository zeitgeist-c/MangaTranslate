# MangaLens TR 3.9.2 — batched adaptive chapter translation

[Türkçe kullanım kılavuzu](README.tr.md)

Manifest V3 extension for Brave/Chromium. Translates English manga, manhwa and manhua into Turkish through Gemini, OpenRouter or Ollama. Manual selection and quick translation remain available.

Full-chapter processing is a **preview**: complete coverage and the planned 98% quality target have not passed human-reviewed acceptance. Uncertain regions, unsafe backgrounds and text overflow remain available for review.

Extract `dist/MangaLensTR-3.9.2.zip`, load its folder through Developer mode in `brave://extensions`. For an existing unpacked installation, keep the same folder/extension identity and reload the extension, reader and settings tabs. To run live from source, load the `dist/` folder itself unpacked after `package.ps1` refreshes it. Start a new chapter job after this upgrade: processing version changed. The compact popup selects provider/model automatically and shows the active key label. Its gear opens settings with matching multi-key lists for Gemini/OpenRouter/Ollama. Existing keys remain intact.

Key cards distinguish saved keys from explicitly checked connections. Checks use provider metadata endpoints without generating a translation; success does not confirm model access or age attestation. Keys remain masked, changing the active key affects subsequent requests, and deleting the last key disables translation for that provider. Requests rotate across saved keys (active key first), each key serving up to 5 concurrent sends; full keys are skipped, the order wraps, and a 429/quota key rests for a while. Collapsing the reader panel keeps processing; closing pauses it.

Only the selected model is called, except automatic Gemini fallback to the next listed model on 429/503 (rejected requests are not billed). No automatic retry of potentially billed requests. Completed results are cached by source, processing/profile version, model, glossary and context. Each job freezes its settings. Contributor models require explicit consent. Actual provider tests were declined by the owner; tests use synthetic translation replies.

Fast detection now uses PP-OCR text groups directly, with WebGPU where supported and verified-model CPU fallback. The heavy balloon detectors remain optional. Readable dark translation cards overlay source-pixel boxes without altering original image files or reconstructing backgrounds. PNG crop encoding avoids hidden-document idle throttling. OpenRouter now batches across chapter images and shares an adaptive 4→6→8 scheduler across tabs. Up to 20 crops/16384 output tokens when metadata verifies capacity, otherwise 12/8192; complete JSON bodies are capped at 8 MiB. Region caches survive regrouping and worker restarts. New cards appear as groups finish. Provider watchdogs are per model (Qwen/Haiku 90 seconds, Muse 60 seconds), and quota/budget/uncertain failures stop new dispatch without automatic paid retry. Transient provider overload (429/503/5xx) is retried up to 3 times with growing delays, then chains to the next Gemini model on 429/503, otherwise waits on a countdown with automatic resume. Both providers rotate requests across saved keys (active key first, up to 5 concurrent sends per key, wrapping around, resting 429/quota keys); direct Gemini additionally keeps 12 requests/minute/key with one lane per key (up to 4) and 2.5 s per-key spacing, plus automatic resume when the window frees; per-page request counts appear in the panel counter and diagnostics. Timings separate local detection, provider waits and drawing. [3.8.0 measurements and acceptance limits](docs/TOPLU-CEVIRI-3.8.0.md). OpenRouter Gemini 2.5/3.1 Lite entries were removed; direct Gemini is preserved. The local text path now uses DB quad postprocessing, dark-tile inversion and shifted seam checks. No live provider speed/quality claim is made.

Keys stay in extension local storage and go only to their provider. Preferences use sync, glossaries/jobs use local storage, detection/translation caches use IndexedDB. No telemetry was added. The unchanged 3.1.7 checkpoint is documented in [recovery instructions](docs/GERI-DONUS-NOKTASI-2026-10-13.md). Preserve current source, storage and IndexedDB before future rollback.

```powershell
node --test tests/*.test.js tests/*.test.mjs evaluation/tests/*.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1
```

Existing same-version packages are never overwritten. See [implementation/acceptance tracking](docs/UYGULAMA-TAKIBI-2026-10-13.md), [evaluation lab](evaluation/README.md) and [third-party licenses](src/page/licenses/). The overall project license is not yet specified.
