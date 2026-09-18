'use strict';

// Pure, shared matching logic. Both the service worker and Node tests use it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MLLocalMatch = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function trigrams(value) {
    const source = normalize(value).replace(/\s+/g, ' ');
    const set = new Set();
    for (let i = 0; i + 3 <= source.length; i++) set.add(source.slice(i, i + 3));
    return set;
  }

  function similarity(a, b) {
    const left = trigrams(a), right = trigrams(b);
    if (!left.size || !right.size) return 0;
    let shared = 0;
    left.forEach(x => { if (right.has(x)) shared++; });
    return (2 * shared) / (left.size + right.size);
  }

  function center(box) {
    return [box[0] + (box[2] - box[0]) / 2, box[1] + (box[3] - box[1]) / 2];
  }

  function validBox(box, w, h) {
    return Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) &&
      box[0] >= 0 && box[1] >= 0 && box[2] <= w && box[3] <= h &&
      box[2] - box[0] >= 8 && box[3] - box[1] >= 8;
  }

  function overlapFraction(a, b) {
    const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
      Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    return intersection / Math.max(1, Math.min((a[2]-a[0])*(a[3]-a[1]), (b[2]-b[0])*(b[3]-b[1])));
  }

  function refine(bubbles, matches, width, height) {
    if (!Array.isArray(bubbles) || !Array.isArray(matches) || !(width > 0) || !(height > 0)) {
      return { bubbles: bubbles || [], placed: 0 };
    }
    const available = matches.filter(m => m && (
      (!m.needs_review && Number(m.bubble_confidence) >= 0.7 && validBox(m.bubble_box, width, height)) ||
      ((m.reason === 'text_outside_detected_bubble' || m.reason === 'ocr_only') &&
        validBox(m.ocr_safe_rect, width, height))));
    const proposals = [];
    bubbles.forEach((bubble, index) => {
      const old = [Number(bubble.x), Number(bubble.y), Number(bubble.x) + Number(bubble.width), Number(bubble.y) + Number(bubble.height)];
      if (!validBox(old, width, height)) return;
      const [cx, cy] = center(old);
      available.forEach((match, target) => {
        const textOnly = match.reason === 'text_outside_detected_bubble' || match.reason === 'ocr_only';
        const [mx, my] = center(textOnly ? match.ocr_safe_rect : (match.text_box || match.bubble_box));
        const distance = Math.hypot((mx - cx) / width, (my - cy) / height);
        if (distance > 0.3) return;
        const lexical = similarity(bubble.text, match.ocr);
        const sourceText = normalize(bubble.text), detectedText = normalize(match.ocr);
        if (!sourceText || !detectedText) return;
        if (sourceText.length < 4 || detectedText.length < 4) {
          if (sourceText !== detectedText) return;
        } else if (lexical < 0.38) return;
        if (textOnly && (lexical < 0.5 || distance > 0.25)) return;
        // A remote box can drift, but proximity alone cannot establish text ownership.
        const score = lexical * 0.72 + Math.max(0, 1 - distance / 0.5) * 0.28;
        proposals.push({ index, target, score, lexical, distance });
      });
    });
    proposals.sort((a, b) => b.score - a.score);
    const usedBubbles = new Set(), usedTargets = new Set(), usedBoxes = [];
    const output = bubbles.map(b => Object.assign({}, b));
    for (const proposal of proposals) {
      if (usedBubbles.has(proposal.index) || usedTargets.has(proposal.target)) continue;
      const match = available[proposal.target];
      const box = match.reason === 'text_outside_detected_bubble' || match.reason === 'ocr_only' ?
        match.ocr_safe_rect : match.bubble_box;
      if (usedBoxes.some(used => overlapFraction(used, box) > 0.3)) continue;
      output[proposal.index] = Object.assign({}, output[proposal.index], {
        x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1],
        localPlacement: true,
      });
      usedBubbles.add(proposal.index);
      usedTargets.add(proposal.target);
      usedBoxes.push(box);
    }
    return { bubbles: output, placed: usedBubbles.size };
  }

  return { normalize, similarity, validBox, refine };
});
