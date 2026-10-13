"""Immutable tracked-source/package checkpoint; never restores into the live project."""
import hashlib, json, pathlib, subprocess, sys, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
target = pathlib.Path(sys.argv[1]).resolve()
version = json.loads((root/'manifest.json').read_text(encoding='utf-8-sig'))['version']
if target.exists():
    raise SystemExit('Checkpoint already exists; refusing overwrite')
target.mkdir(parents=True)
for area in ('source', 'distribution', 'restore-proof'):
    (target/area).mkdir()
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])
def digest(data): return hashlib.sha256(data).hexdigest()
tracked = git('ls-files', '-z').decode().split('\0')[:-1]
records = []
source = target/'source'/f'MangaLensTR-{version}.zip'
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED) as archive:
    for name in tracked:
        data = (root/name).read_bytes()
        archive.writestr(name, data)
        records.append(dict(path=name, bytes=len(data), sha256=digest(data)))
with zipfile.ZipFile(source) as archive:
    for record in records:
        restored = target/'restore-proof'/record['path']
        restored.parent.mkdir(parents=True, exist_ok=True)
        restored.write_bytes(archive.read(record['path']))
        assert digest(restored.read_bytes()) == record['sha256']
package = root/f'MangaLensTR-{version}.zip'
package_data = package.read_bytes()
with zipfile.ZipFile(package) as archive:
    assert json.loads(archive.read('manifest.json'))['version'] == version
    for entry in archive.infolist():
        if not entry.is_dir():
            assert archive.read(entry.filename) == (root/entry.filename).read_bytes(), entry.filename
(target/'distribution'/package.name).write_bytes(package_data)
git('bundle','create',str(target/'repository.bundle'),'--all')
git('bundle','verify',str(target/'repository.bundle'))
metadata = dict(version=version, commit=git('rev-parse','HEAD').decode().strip(),
    tagCommit=git('rev-parse',f'v{version}^{{}}').decode().strip(),
    sourceSha256=digest(source.read_bytes()), packageSha256=digest(package_data),
    sourceFiles=len(records), physicalRestoreVerified=True, packageMatchesSource=True,
    excluded='Ignored files, previous archives, dependencies and untracked user WIP remain in original workspace.',
    worktreeStatus=git('status','--short').decode(), files=records)
(target/'checkpoint.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in metadata.items() if k not in ('files','worktreeStatus')},ensure_ascii=False))
