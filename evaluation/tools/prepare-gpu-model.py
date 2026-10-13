"""Narrow graph rewrite: ceil/floor are identical for integer stride=1 pools.
No weight changes; refuse other pooling contracts instead of guessing padding.
"""
import sys, pathlib, hashlib, json
root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.local/python-deps'))
import onnx
source = root / '.local/models/detector-v4-s_int8.onnx'
expected = '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79'
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
model = onnx.load(source)
changed = []
for node in model.graph.node:
    if node.op_type not in ('MaxPool', 'AveragePool'): continue
    attrs = {a.name: a for a in node.attribute}
    if attrs.get('ceil_mode') is None or attrs['ceil_mode'].i != 1: continue
    strides = list(attrs['strides'].ints) if 'strides' in attrs else [1] * len(attrs['kernel_shape'].ints)
    assert all(s == 1 for s in strides), f'Unsupported non-unit stride: {node.name}'
    attrs['ceil_mode'].i = 0
    changed.append(node.name)
assert changed, 'No eligible ceil_mode node'
onnx.checker.check_model(model)
destination = source.with_name('detector-v4-s_int8-gpu.onnx')
onnx.save(model, destination)
receipt = {'sourceSHA256': expected, 'outputSHA256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'file': destination.name,
           'nodes': changed, 'reason': 'Unit-stride pooling has integer output numerator: ceil equals floor for every integer input size. Weights unchanged.',
           'onnxVersion': onnx.__version__, 'numericalParityMeasured': False}
(root / '.local/models/gpu-rewrite-receipt.json').write_text(json.dumps(receipt, indent=2))
registry_path = root / '.local/models/registry.json'
registry = json.loads(registry_path.read_text())
entry = next(m.copy() for m in registry['models'] if m['id'] == 'rtdetr-v4-small')
entry.update(id='rtdetr-v4-small-gpu', file=destination.name, sha256=receipt['outputSHA256'], bytes=destination.stat().st_size,
             derivative=receipt)
registry['models'] = [m for m in registry['models'] if m['id'] != entry['id']] + [entry]
registry_path.write_text(json.dumps(registry, indent=2))
print(json.dumps(receipt))
