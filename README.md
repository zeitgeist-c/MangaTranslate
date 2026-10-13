# MangaLens TR 3.5.2 — full-chapter preview

[Türkçe kullanım kılavuzu](README.tr.md)

Manifest V3 extension for Brave/Chromium. Translates English manga, manhwa and manhua into Turkish through Gemini or OpenRouter. Manual selection and quick translation remain available.

Full-chapter processing is a **preview**: complete coverage and the planned 98% quality target have not passed human-reviewed acceptance. Uncertain regions, unsafe backgrounds and text overflow remain available for review.

Extract `MangaLensTR-3.5.2.zip`, load its folder through Developer mode in `brave://extensions`. For an existing unpacked installation, reload the extension and reader tab. Select a provider, add its separate key, choose a model and save. **Bölümün tamamını çevir** processes the current chapter sequentially; the page panel supports pause/resume, explicit retry, original toggle and review details.

Only the selected model is called. No silent model fallback or automatic retry of potentially billed requests. Completed results are cached by source, processing/profile version, model, glossary and context. Each job freezes its settings. Contributor models require explicit consent. Actual provider tests were declined by the owner; tests use synthetic translation replies.

Local models and ONNX JS/WASM are bundled. Translation models read identified crops and never generate placement coordinates. Flat interiors are checked before old ink pixels are erased; textured art is preserved. The small detector is an experimental option. Production detection uses WASM; GPU candidates failed compatibility/output checks.

Keys stay in extension local storage and go only to their provider. Preferences use sync, glossaries/jobs use local storage, detection/translation caches use IndexedDB. No telemetry was added. The unchanged 3.1.7 checkpoint is documented in [recovery instructions](docs/GERI-DONUS-NOKTASI-2026-10-13.md). Preserve current source, storage and IndexedDB before future rollback.

```powershell
node --test tests/*.test.js tests/*.test.mjs evaluation/tests/*.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1
```

Existing same-version packages are never overwritten. See [implementation/acceptance tracking](docs/UYGULAMA-TAKIBI-2026-10-13.md), [evaluation lab](evaluation/README.md) and [third-party licenses](src/page/licenses/). The overall project license is not yet specified.
