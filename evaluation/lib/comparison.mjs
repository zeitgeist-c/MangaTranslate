import { area, intersection } from './geometry.mjs';

// Diagnostic only: a text line is not interchangeable with a dialogue group.
// Keep every independent line, including ambiguous and uncovered ones.
export function compareDetectors(groups, lines, coverage = 0.8) {
  if (groups.imageId !== lines.imageId || groups.width !== lines.width || groups.height !== lines.height)
    throw new Error('Source identity/dimensions mismatch');
  if (!(coverage > 0 && coverage <= 1)) throw new Error('Invalid coverage threshold');
  const items = lines.regions.map(line => {
    const candidates = groups.regions.filter(group => intersection(line.textBox, group.textBox) / area(line.textBox) >= coverage);
    return { lineId: line.regionId, textBox: line.textBox, candidateGroupIds: candidates.map(g => g.regionId),
      status: candidates.length === 0 ? 'uncovered' : candidates.length === 1 ? 'covered' : 'ambiguous',
      groupId: candidates.length === 1 ? candidates[0].regionId : null };
  });
  return { imageId: groups.imageId, width: groups.width, height: groups.height, coverageThreshold: coverage,
    groupModel: groups.modelId, lineModel: lines.modelId, items,
    counts: Object.fromEntries(['covered', 'uncovered', 'ambiguous'].map(key => [key, items.filter(i => i.status === key).length])),
    qualityMeasured: false, note: 'Uncovered line candidates require visual review. They are not proven missed text. No automatic group merging or bubble assignment.' };
}
