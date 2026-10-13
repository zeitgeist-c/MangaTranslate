"""Locate supplied failure crops in local chapter files; no remote calls or image edits."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
ratio = 1 / 6
templates = {name: Image.open(root / '.local/regressions' / (name + '.png')).convert('RGB') for name in ['purple', 'title', 'black']}
best = {name: {'score': -1} for name in templates}

def windows(values, h, w):
    integral = np.pad(values.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    return integral[h:, w:] - integral[:-h, w:] - integral[h:, :-w] + integral[:-h, :-w]

for file in sorted((root / '.local/chapter-174').glob('*.webp')):
    image = Image.open(file).convert('RGB')
    a = np.asarray(image.resize((round(image.width * ratio), round(image.height * ratio))), dtype=np.float64)
    height, width, _ = a.shape
    shape = (2 ** (height + 128 - 1).bit_length(), 2 ** (width + 128 - 1).bit_length())
    source_fft = [np.fft.rfft2(a[:, :, c], s=shape) for c in range(3)]
    for name, template in templates.items():
        for scale in [.75, .9, 1, 1.1, 1.25, 1.5]:
            w, h = round(template.width * ratio * scale), round(template.height * ratio * scale)
            if h > height or w > width: continue
            t = np.asarray(template.resize((w, h)), dtype=np.float64)
            centered = t - t.mean((0, 1))
            variance = (centered * centered).sum()
            if variance < 1: continue
            numerator = sum(np.fft.irfft2(source_fft[c] * np.conj(np.fft.rfft2(centered[:, :, c], s=shape)), s=shape)[:height - h + 1, :width - w + 1] for c in range(3))
            denominator = sum(windows(a[:, :, c] ** 2, h, w) - windows(a[:, :, c], h, w) ** 2 / (h * w) for c in range(3))
            scores = numerator / np.sqrt(np.maximum(denominator, 1e-8) * variance)
            y, x = np.unravel_index(scores.argmax(), scores.shape)
            score = float(scores[y, x])
            if score > best[name]['score']:
                best[name] = {'score': score, 'file': file.name, 'scale': scale, 'box': [x / ratio, y / ratio, (x + w) / ratio, (y + h) / ratio], 'sourceSize': [image.width, image.height]}
    print(file.name, {name: round(v['score'], 3) for name, v in best.items()}, flush=True)
for value in best.values():
    value['accepted'] = value['score'] >= .85
(root / 'reports/regression-locations.json').write_text(json.dumps(best, indent=2), encoding='utf-8')
print(json.dumps(best, indent=2))
