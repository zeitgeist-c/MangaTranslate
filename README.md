# MangaLens TR 3.8.0 — batched adaptive chapter translation

[Türkçe kullanım kılavuzu](README.tr.md)

Manifest V3 extension for Brave/Chromium. Translates English manga, manhwa and manhua into Turkish through Gemini or OpenRouter. Manual selection and quick translation remain available.

Full-chapter processing is a **preview**: complete coverage and the planned 98% quality target have not passed human-reviewed acceptance. Uncertain regions, unsafe backgrounds and text overflow remain available for review.

Extract `MangaLensTR-3.8.0.zip`, load its folder through Developer mode in `brave://extensions`. For an existing unpacked installation, keep the same folder/extension identity and reload the extension, reader and settings tabs. Start a new chapter job after this upgrade: processing version changed. The compact popup selects provider/model automatically and shows the active key label. Its gear opens settings with matching multi-key lists for Gemini/OpenRouter. Existing keys remain intact.

Key cards distinguish saved keys from explicitly checked connections. Checks use provider metadata endpoints without generating a translation; success does not confirm model access or age attestation. Keys remain masked, changing the active key affects subsequent requests, and deleting the last key disables translation for that provider. Collapsing the reader panel keeps processing; closing pauses it.

Only the selected model is called. No silent model fallback or automatic retry of potentially billed requests. Completed results are cached by source, processing/profile version, model, glossary and context. Each job freezes its settings. Contributor models require explicit consent. Actual provider tests were declined by the owner; tests use synthetic translation replies.

Fast detection now uses PP-OCR text groups directly, with WebGPU where supported and verified-model CPU fallback. The heavy balloon detectors remain optional. Readable dark translation cards overlay source-pixel boxes without altering original image files or reconstructing backgrounds. PNG crop encoding avoids hidden-document idle throttling. OpenRouter now batches across chapter images and shares an adaptive 4→6→8 scheduler across tabs. Up to 20 crops/16384 output tokens when metadata verifies capacity, otherwise 12/8192; complete JSON bodies are capped at 8 MiB. Region caches survive regrouping and worker restarts. New cards appear as groups finish. The provider watchdog is 60 seconds and quota/budget/uncertain failures stop new dispatch without automatic paid retry. Direct Gemini pacing remains unchanged. Timings separate local detection, provider waits and drawing. [3.8.0 measurements and acceptance limits](docs/TOPLU-CEVIRI-3.8.0.md). OpenRouter Gemini 2.5/3.1 Lite entries were removed; direct Gemini is preserved. The local text path now uses DB quad postprocessing, dark-tile inversion and shifted seam checks. No live provider speed/quality claim is made.

Keys stay in extension local storage and go only to their provider. Preferences use sync, glossaries/jobs use local storage, detection/translation caches use IndexedDB. No telemetry was added. The unchanged 3.1.7 checkpoint is documented in [recovery instructions](docs/GERI-DONUS-NOKTASI-2026-10-13.md). Preserve current source, storage and IndexedDB before future rollback.

```powershell
node --test tests/*.test.js tests/*.test.mjs evaluation/tests/*.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1
```

Existing same-version packages are never overwritten. See [implementation/acceptance tracking](docs/UYGULAMA-TAKIBI-2026-10-13.md), [evaluation lab](evaluation/README.md) and [third-party licenses](src/page/licenses/). The overall project license is not yet specified.
