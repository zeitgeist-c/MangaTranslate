import { area, intersection, clipBox } from './lib/geometry.mjs';

export function fuseGroups(primary, independent) {
  const regions = primary.regions.map(r => ({ ...r }));
  const unassigned = [];
  for (const line of independent.regions) {
    if (regions.some(r => intersection(r.textBox, line.textBox) / area(line.textBox) >= .8)) continue;
    const candidates = primary.bubbles.filter(b => intersection(b.box, line.textBox) / area(line.textBox) >= .95);
    if (candidates.length !== 1) { unassigned.push({ ...line, needsReview: true, reason: 'independent_unmatched_text' }); continue; }
    const balloon = candidates[0];
    const existing = regions.filter(r => r.bubbleId === balloon.id);
    if (existing.length > 1) { unassigned.push({ ...line, needsReview: true, reason: 'multiple_groups_in_bubble' }); continue; }
    if (existing.length === 1) {
      const b = existing[0].textBox, c = line.textBox;
      existing[0].textBox = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])];
      existing[0].needsReview = true; existing[0].reason = 'independent_extension';
    } else regions.push({ ...line, bubbleId: balloon.id, bubbleBox: balloon.box, needsReview: true, reason: 'independent_group' });
  }
  return [...regions, ...unassigned].sort((a, b) => a.textBox[1] - b.textBox[1] || a.textBox[0] - b.textBox[0]);
}

// Flood-filled flat interior. Shape and text rectangle are different data.
export function interior(rgba, width, height, textBox) {
  const [x0, y0, x1, y1] = textBox.map(Math.round);
  const candidates = [], bins = new Map();
  for (let y = Math.max(0, y0 - 3); y < Math.min(height, y1 + 3); y += Math.max(1, Math.floor((y1 - y0) / 8)))
    for (let x = Math.max(0, x0 - 3); x < Math.min(width, x1 + 3); x += Math.max(1, Math.floor((x1 - x0) / 8))) {
      const i = (y * width + x) * 4, values = [rgba[i], rgba[i + 1], rgba[i + 2]];
      const key = values.map(v => v >> 4).join(',');
      const item = { x, y, values }; candidates.push(item);
      if (!bins.has(key)) bins.set(key, []); bins.get(key).push(item);
    }
  if (!candidates.length) return null;
  const dominant = [...bins.values()].sort((a, b) => b.length - a.length)[0];
  if (dominant.length / candidates.length < .6) return null;
  const background = [0, 1, 2].map(c => dominant.map(p => p.values[c]).sort((a, b) => a - b)[Math.floor(dominant.length / 2)]);
  const linear = background.map(v => v / 255 <= .04045 ? v / 255 / 12.92 : ((v / 255 + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  const light = (luminance + .05) / .05 >= 1.05 / (luminance + .05);
  const seed = dominant.find(p => p.values.every((v, c) => Math.abs(v - background[c]) <= 12));
  if (!seed) return null;
  const visited = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 1; queue[0] = seed.y * width + seed.x; visited[queue[0]] = 1;
  function flat(i) { const p = i * 4; return Math.abs(rgba[p] - background[0]) <= 12 && Math.abs(rgba[p + 1] - background[1]) <= 12 && Math.abs(rgba[p + 2] - background[2]) <= 12; }
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy, n = ny * width + nx;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[n] && flat(n)) { visited[n] = 1; queue[tail++] = n; }
    }
  }
  const rows = [];
  for (let y = 0; y < height; y++) {
    // Use the run containing/nearest the text center, never the balloon tail center.
    const center = Math.min(width - 1, Math.max(0, Math.round((x0 + x1) / 2)));
    let left = center, right = center;
    while (left > 0 && visited[y * width + left - 1]) left--;
    while (right < width - 1 && visited[y * width + right + 1]) right++;
    rows.push(visited[y * width + center] ? [left + 4, right - 4] : null);
  }
  // Text holes are allowed, but a mostly non-flat crop is unsafe to erase.
  let flatCount = 0, total = 0;
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
    const i = y * width + x, p = i * 4; total++; if (visited[i]) flatCount++;
  }
  if (!total || flatCount / total < .65 || tail < total) return null;
  // A flat ring must surround all old ink. Otherwise a rectangle could cross art/border.
  for (let x = Math.max(0, x0 - 2); x <= Math.min(width - 1, x1 + 2); x++)
    if (!visited[Math.max(0, y0 - 2) * width + x] || !visited[Math.min(height - 1, y1 + 2) * width + x]) return null;
  for (let y = Math.max(0, y0 - 2); y <= Math.min(height - 1, y1 + 2); y++)
    if (!visited[y * width + Math.max(0, x0 - 2)] || !visited[y * width + Math.min(width - 1, x1 + 2)]) return null;
  // Bridge only verified ink holes for layout; the erase mask still comes from original pixels.
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
    let left = Math.max(0, x0), right = Math.min(width - 1, x1);
    while (left > 0 && visited[y * width + left - 1]) left--;
    while (right < width - 1 && visited[y * width + right + 1]) right++;
    rows[y] = [left + 4, right - 4];
  }
  return { light, background, rows, mask: visited, fraction: flatCount / total };
}

export function wrapText(text, measure, width) {
  const lines = []; let line = '';
  for (const paragraph of text.split(/\n/)) {
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (measure(word) > width) return null;
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width) line = next;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line); line = '';
  }
  return lines;
}

export function fitText(ctx, text, shape, textBox, minFont = 12, maxFont = 30) {
  const centerY = (textBox[1] + textBox[3]) / 2, centerX = (textBox[0] + textBox[2]) / 2;
  for (let size = maxFont; size >= minFont; size--) {
    ctx.font = `600 ${size}px Arial, sans-serif`;
    // Conservative shared width over the original text height, then verify all new rows.
    let left = 0, right = ctx.canvas.width;
    const reference = shape.rows.slice(Math.max(0, Math.floor(textBox[1])), Math.min(shape.rows.length, Math.ceil(textBox[3]))).filter(Boolean);
    if (!reference.length) continue;
    for (const row of reference) { left = Math.max(left, row[0]); right = Math.min(right, row[1]); }
    const width = Math.min(right - left, 2 * Math.min(centerX - left, right - centerX));
    const lines = wrapText(text, value => ctx.measureText(value).width, width);
    if (!lines?.length) continue;
    const step = size * 1.2, top = centerY - lines.length * step / 2;
    if (top < 0 || top + lines.length * step > shape.rows.length) continue;
    let safe = true;
    for (let i = 0; i < lines.length && safe; i++) {
      const half = ctx.measureText(lines[i]).width / 2;
      for (let y = Math.floor(top + i * step); y < Math.ceil(top + (i + 1) * step); y++) {
        const row = shape.rows[y];
        if (!row || centerX - half < row[0] || centerX + half > row[1]) { safe = false; break; }
      }
    }
    if (safe) return { size, lines, x: centerX, top, step };
  }
  return null;
}

export function regionCrop(region, width, height, padding = 6) {
  const b = region.textBox;
  return clipBox([Math.floor(b[0] - padding), Math.floor(b[1] - padding), Math.ceil(b[2] + padding), Math.ceil(b[3] + padding)], width, height);
}
