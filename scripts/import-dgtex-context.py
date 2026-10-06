"""Manual, bounded operator import of dGTEx V1 open-access data. Python stdlib only."""
import argparse
import json
import os
import urllib.request
from pathlib import Path
from evidence_context.dgtex import BASE, FILES, build_snapshot

parser = argparse.ArgumentParser()
parser.add_argument('--input-dir', help='Use existing original files, named exactly as on the portal')
parser.add_argument('--output', default=os.environ.get('DGTEX_CONTEXT_PATH', 'data/dgtex-context.sqlite'))
args = parser.parse_args()
directory = Path(args.input_dir or 'data/dgtex-v1-input')
directory.mkdir(parents=True, exist_ok=True)
paths = {}
for key, remote in FILES.items():
    file = directory / Path(remote).name
    if not args.input_dir:
        temporary = file.with_name(file.name + '.download')
        with urllib.request.urlopen(BASE + remote, timeout=60) as response, open(temporary, 'wb') as output:
            for block in iter(lambda: response.read(1024 * 1024), b''):
                output.write(block)
        temporary.replace(file)
    paths[key] = file
manifest = build_snapshot(paths, args.output, 'local-import' if args.input_dir else 'download')
print(json.dumps({'path': args.output, 'geneCount': manifest['geneCount'], 'groups': len(manifest['coverage']), 'counts': manifest['counts'], 'sha256': manifest['provenance']['sha256']}))
