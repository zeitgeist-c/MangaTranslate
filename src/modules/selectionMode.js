// dosya: src/modules/selectionMode.js
// MangaLens TR — Alan Secim Modulu
// Popup'taki "Alan Sec" butonu veya Alt+S kisayolu ile aktif olur.
// Kullanici ekran uzerinde dikdortgen alan cizer; alan captureVisibleTab ile
// yakalanip multimodal AI ile cevirilir; secili alana data URL olarak basilir.
// FIX-01/02/05 korunur.

'use strict';

import { NS, MAX_SELECTIONS } from './constants.js';
import { imageToCanvas } from './imagePipeline.js';
import { extractBubbles } from './aiClient.js';
import { canvasToJpegDataUrl } from './imagePipeline.js';

// ── Durum ─────────────────────────────────────────────────────────────────────
let selectionMode     = false;
let isSelecting       = false;
let selectionStart    = null;
let currentSelection  = null;
let selectedAreas     = [];
let selectionOverlay  = null;
let selectionControls = null;

let cachedOverlayStyle = 'white';

// ── Public API ────────────────────────────────────────────────────────────────

export function isSelectionModeActive() {
  return selectionMode;
}

export function enterSelectionMode(overlayStyle = 'white') {
  if (selectionMode) return;
  selectionMode = true;
  selectedAreas = [];
  cachedOverlayStyle = overlayStyle;

  document.body.style.cursor = 'crosshair';

  selectionOverlay = document.createElement('div');
  selectionOverlay.className = `${NS}-selection-overlay`;
  selectionOverlay.style.cssText = `
    position: fixed !important;
    top: 0 !important; left: 0 !important;
    width: 100% !important; height: 100% !important;
    background: rgba(0, 0, 0, 0.3) !important;
    z-index: 99998 !important;
    pointer-events: none !important;
  `;
  document.body.appendChild(selectionOverlay);

  document.addEventListener('mousedown', onSelectionStart, true);
  document.addEventListener('mousemove', onSelectionMove, true);
  document.addEventListener('mouseup',   onSelectionEnd,   true);
  document.addEventListener('keydown',   onSelectionKeydown, true);

  showSelectionControls();
}

export function exitSelectionMode() {
  if (!selectionMode) return;
  selectionMode = false;
  isSelecting = false;
  selectionStart = null;
  currentSelection = null;

  document.body.style.cursor = '';

  // FIX-01: capture flag removeEventListener'da
  document.removeEventListener('mousedown', onSelectionStart, true);
  document.removeEventListener('mousemove', onSelectionMove, true);
  document.removeEventListener('mouseup',   onSelectionEnd,   true);
  document.removeEventListener('keydown',   onSelectionKeydown, true);

  document.querySelectorAll(`.${NS}-selection-box`).forEach(el => el.remove());
  selectionOverlay?.remove();
  selectionControls?.remove();

  selectionOverlay = null;
  selectionControls = null;
}

export async function confirmSelection() {
  if (selectedAreas.length === 0) {
    exitSelectionMode();
    return;
  }
  const areas = selectedAreas.slice();
  exitSelectionMode();
  await translateSelectedAreas(areas);
}

export function clearSelection() {
  selectedAreas = [];
  document.querySelectorAll(`.${NS}-selection-box`).forEach(el => el.remove());
  updateSelectionCount();
}

// ── Dahili: UI ────────────────────────────────────────────────────────────────

function showSelectionControls() {
  selectionControls = document.createElement('div');
  selectionControls.className = `${NS}-selection-controls`;
  selectionControls.style.cssText = `
    position: fixed !important;
    bottom: 20px !important; left: 50% !important;
    transform: translateX(-50%) !important;
    background: rgba(20, 10, 40, 0.95) !important;
    border: 1px solid rgba(124, 58, 237, 0.4) !important;
    border-radius: 8px !important;
    padding: 10px 16px !important;
    display: flex !important; gap: 10px !important;
    z-index: 99999 !important;
  `;
  selectionControls.innerHTML = `
    <span style="color:#c4b5fd;font-size:12px;align-self:center;">
      Secili: <span id="${NS}-sel-count">0</span>/${MAX_SELECTIONS}
    </span>
    <button class="${NS}-sel-btn secondary" id="${NS}-sel-cancel" style="
      padding:6px 16px;border-radius:4px;
      border:1px solid rgba(124,58,237,0.4);
      font-size:12px;font-weight:600;cursor:pointer;
      background:rgba(124,58,237,0.2);color:#c4b5fd;">Iptal (Esc)</button>
    <button class="${NS}-sel-btn primary" id="${NS}-sel-confirm" style="
      padding:6px 16px;border-radius:4px;border:none;
      font-size:12px;font-weight:600;cursor:pointer;
      background:#e5193a;color:white;">Cevir (Enter)</button>
  `;
  document.body.appendChild(selectionControls);

  document.getElementById(`${NS}-sel-cancel`)?.addEventListener('click', exitSelectionMode);
  document.getElementById(`${NS}-sel-confirm`)?.addEventListener('click', confirmSelection);
}

function updateSelectionCount() {
  const el = document.getElementById(`${NS}-sel-count`);
  if (el) el.textContent = selectedAreas.length;
}

// ── Mouse Event Handlers ──────────────────────────────────────────────────────

function onSelectionStart(e) {
  if (e.target.closest(`.${NS}-selection-controls`)) return;
  if (e.target.closest(`.${NS}-selection-box`)) return;
  if (selectedAreas.length >= MAX_SELECTIONS) return;
  if (e.button !== 0) return;

  isSelecting = true;
  selectionStart = { x: e.clientX, y: e.clientY };

  currentSelection = document.createElement('div');
  currentSelection.className = `${NS}-selection-box`;
  currentSelection.style.cssText = `
    position: absolute !important;
    border: 2px solid #e5193a !important;
    background: rgba(229, 25, 58, 0.1) !important;
    pointer-events: auto !important;
    cursor: move !important;
    z-index: 99999 !important;
  `;
  document.body.appendChild(currentSelection);
}

function onSelectionMove(e) {
  if (!isSelecting || !selectionStart || !currentSelection) return;

  const x = Math.min(selectionStart.x, e.clientX);
  const y = Math.min(selectionStart.y, e.clientY);
  const w = Math.abs(e.clientX - selectionStart.x);
  const h = Math.abs(e.clientY - selectionStart.y);

  Object.assign(currentSelection.style, {
    left: `${x}px`, top: `${y}px`,
    width: `${w}px`, height: `${h}px`,
  });
}

function onSelectionEnd() {
  if (!isSelecting || !currentSelection) return;
  isSelecting = false;

  const rect = currentSelection.getBoundingClientRect();
  const area = {
    x: rect.left, y: rect.top,
    width: rect.width, height: rect.height,
  };

  if (area.width > 20 && area.height > 20) {
    selectedAreas.push(area);
    updateSelectionCount();

    // FIX-05: data-area-index attribute
    currentSelection.dataset.areaIndex = selectedAreas.length - 1;
    const label = document.createElement('div');
    label.className = `${NS}-selection-label`;
    label.textContent = 'x';
    label.title = 'Secimi kaldir';
    label.style.cssText = `
      position: absolute !important;
      top: -24px !important; left: 0 !important;
      background: #e5193a !important;
      color: white !important;
      padding: 2px 8px !important;
      border-radius: 4px 4px 0 0 !important;
      font-size: 11px !important;
      font-family: system-ui, sans-serif !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      z-index: 100000 !important;
    `;
    label.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const box = ev.target.closest(`.${NS}-selection-box`);
      const idx = box ? parseInt(box.dataset.areaIndex, 10) : -1;
      if (idx >= 0) removeArea(idx);
    });
    currentSelection.appendChild(label);
  } else {
    currentSelection.remove();
  }

  currentSelection = null;
  selectionStart = null;
}

function onSelectionKeydown(e) {
  if (e.key === 'Escape') {
    exitSelectionMode();
  } else if (e.key === 'Enter') {
    confirmSelection();
  }
}

function removeArea(index) {
  if (index < 0 || index >= selectedAreas.length) return;
  selectedAreas.splice(index, 1);
  updateSelectionCount();

  const box = document.querySelector(`.${NS}-selection-box[data-area-index="${index}"]`);
  box?.remove();

  reindexSelectionBoxes();
}

function reindexSelectionBoxes() {
  document.querySelectorAll(`.${NS}-selection-box`).forEach((box, i) => {
    box.dataset.areaIndex = i;
    const label = box.querySelector(`.${NS}-selection-label`);
    if (label) {
      label.onclick = (ev) => {
        ev.stopPropagation();
        const idx = parseInt(box.dataset.areaIndex, 10);
        if (idx >= 0) removeArea(idx);
      };
    }
  });
}

// ── Capture + Translate ───────────────────────────────────────────────────────

/**
 * FIX-02: captureVisibleTab gercek piksel cinsinden doner.
 * Retina/4K ekranlarda (DPR=2) goruntu viewport'tan 2x buyuk olur.
 */
async function captureArea(area) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
    if (!response?.dataUrl) return null;

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(area.width  * dpr);
    canvas.height = Math.round(area.height * dpr);
    const ctx = canvas.getContext('2d');

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(
          img,
          -area.x * dpr, -area.y * dpr,
          img.naturalWidth, img.naturalHeight,
        );
        resolve(canvas);
      };
      img.onerror = () => resolve(null);
      img.src = response.dataUrl;
    });
  } catch {
    return null;
  }
}

async function translateSelectedAreas(areas) {
  for (const area of areas) {
    const canvas = await captureArea(area);
    if (!canvas) continue;

    // Multimodal AI: balonlari bul
    const bubbles = await extractBubbles(canvas);
    if (bubbles.length === 0) continue;

    // Secili alan icin sonucu goster
    renderAreaOverlay(area, bubbles, cachedOverlayStyle);
  }
}

function renderAreaOverlay(area, bubbles, style) {
  // Yerinde tutmak icin: canvas'in data URL'ini bir <img> olarak yerlestir
  // ve uzerine balonlari absolute div olarak ciz.
  // Bu sayfa kontekstinde orijinal icerik BOZULMAZ (overlay yaklasimi).

  const container = document.createElement('div');
  container.className = `${NS}-selection-result`;
  container.style.cssText = `
    position: fixed !important;
    left: ${area.x}px !important;
    top: ${area.y}px !important;
    width: ${area.width}px !important;
    height: ${area.height}px !important;
    border: 2px solid #7c3aed !important;
    background: rgba(20, 10, 40, 0.92) !important;
    z-index: 99997 !important;
    overflow: hidden !important;
    border-radius: 4px !important;
  `;

  // Her balon icin kucuk kutu
  bubbles.forEach((b, i) => {
    const div = document.createElement('div');
    div.className = `${NS}-selection-bubble`;
    div.textContent = b.text || '(bos)';
    div.style.cssText = `
      position: absolute !important;
      left: ${(b.x / 100) * area.width}px !important;
      top: ${(b.y / 100) * area.height}px !important;
      width: ${(b.width / 100) * area.width}px !important;
      min-height: ${(b.height / 100) * area.height}px !important;
      background: ${style === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)'} !important;
      color: #111 !important;
      padding: 4px !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      border-radius: 3px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      text-align: center !important;
      line-height: 1.2 !important;
    `;
    container.appendChild(div);
  });

  // Kapatma butonu
  const closeBtn = document.createElement('div');
  closeBtn.textContent = 'x Kapat';
  closeBtn.style.cssText = `
    position: absolute !important;
    top: -28px !important; right: 0 !important;
    background: #7c3aed !important; color: white !important;
    padding: 4px 10px !important; border-radius: 4px !important;
    font-size: 11px !important; cursor: pointer !important;
    z-index: 100001 !important;
  `;
  closeBtn.addEventListener('click', () => container.remove());
  container.appendChild(closeBtn);

  document.body.appendChild(container);
}
