import { box, iou, intersection, area } from './geometry.mjs';

// Maximum-cardinality bipartite matching: a greedy IoU ranking can undercount TP.
export function matchBoxes(predictions, truth, threshold = 0.5) {
  if (!(threshold > 0 && threshold <= 1)) throw new Error('Invalid IoU threshold');
  predictions.forEach(box); truth.forEach(box);
  const edges = predictions.map(p => truth.map((t, index) => ({ index, overlap: iou(p, t) }))
    .filter(e => e.overlap >= threshold).sort((a, b) => b.overlap - a.overlap));
  const owner = new Map();
  function augment(p, seen) {
    for (const { index } of edges[p]) {
      if (seen.has(index)) continue;
      seen.add(index);
      if (!owner.has(index) || augment(owner.get(index), seen)) { owner.set(index, p); return true; }
    }
    return false;
  }
  for (let p = 0; p < predictions.length; p++) augment(p, new Set());
  return [...owner].map(([truthIndex, predictionIndex]) => ({ truthIndex, predictionIndex,
    iou: iou(predictions[predictionIndex], truth[truthIndex]) }));
}

export function scorePage(prediction, label, threshold = 0.5) {
  if (label.reviewStatus !== 'human-reviewed') throw new Error('Unreviewed labels cannot be acceptance ground truth');
  if (label.imageId !== prediction.imageId || label.width !== prediction.width || label.height !== prediction.height) throw new Error('Image identity/dimensions mismatch');
  const truth = label.regions.filter(r => r.inScope !== false);
  const ignored = label.regions.filter(r => r.inScope === false);
  const pairs = matchBoxes(prediction.regions.map(r => r.textBox), truth.map(r => r.textBox), threshold);
  const bubblePairs = matchBoxes((prediction.bubbles ?? []).map(b => b.box), (label.bubbles ?? []).map(b => b.box), threshold);
  const bubbleMap = new Map(bubblePairs.map(p => [prediction.bubbles[p.predictionIndex].id, label.bubbles[p.truthIndex].id]));
  let wrongAssociation = 0, missingAssociation = 0;
  for (const pair of pairs) {
    const expected = truth[pair.truthIndex].bubbleId ?? null;
    const actual = prediction.regions[pair.predictionIndex].bubbleId ?? null;
    if (actual !== null && (bubbleMap.get(actual) ?? '__unmatched__') !== expected) wrongAssociation++;
    else if (actual === null && expected !== null) missingAssociation++;
  }
  const matched = new Set(pairs.map(p => p.predictionIndex));
  const ignoredPredictions = prediction.regions.filter((r, index) => !matched.has(index) &&
    !truth.some(t => intersection(r.textBox, t.textBox) > 0) &&
    ignored.some(t => intersection(r.textBox, t.textBox) / area(r.textBox) >= .9)).length;
  const considered = prediction.regions.length - ignoredPredictions;
  const tp = pairs.length, fp = considered - tp, fn = truth.length - tp;
  return { truePositive: tp, falsePositive: fp, missed: fn, wrongAssociation, missingAssociation,
    ignoredPredictions, recall: truth.length ? tp / truth.length : null, precision: considered ? tp / considered : null,
    allTextFound: fn === 0, exactDetection: fp === 0 && fn === 0,
    allAssigned: fp === 0 && fn === 0 && wrongAssociation === 0 && missingAssociation === 0, pairs };
}

export function summarize(pages) {
  if (!pages.length) return { pages: 0, acceptancePassed: false, reason: 'no_reviewed_pages' };
  const sums = Object.fromEntries(['truePositive', 'falsePositive', 'missed', 'wrongAssociation', 'missingAssociation'].map(k => [k, pages.reduce((n, p) => n + p[k], 0)]));
  const recall = sums.truePositive + sums.missed ? sums.truePositive / (sums.truePositive + sums.missed) : null;
  const precision = sums.truePositive + sums.falsePositive ? sums.truePositive / (sums.truePositive + sums.falsePositive) : null;
  return { pages: pages.length, ...sums, recall, precision,
    allTextFoundPages: pages.filter(p => p.allTextFound).length, allAssignedPages: pages.filter(p => p.allAssigned).length,
    // Dataset representativeness and page/region counts are separate gates.
    qualityTargetMet: recall !== null && recall >= 0.98 && precision !== null && precision >= 0.98 && sums.wrongAssociation === 0 && sums.missingAssociation === 0 };
}
