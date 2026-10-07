/** Manual operator import: download once, validate fully, replace atomically. The server also installs a MISSING snapshot on first use; it never refreshes one. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadGenccSnapshot, genccSnapshotFromPayload } from '../server/services/evidence-context/gencc.ts';
import { writeSnapshotAtomically } from '../server/services/evidence-context/snapshotInstall.ts';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const snapshot = inputIndex >= 0 ? genccSnapshotFromPayload(await readFile(args[inputIndex + 1], 'utf8'), 'local-import') : await downloadGenccSnapshot();
const target = path.resolve(process.env.GENCC_CONTEXT_PATH ?? 'data/gencc-context.json');
await writeSnapshotAtomically(target, snapshot);
console.log(JSON.stringify({ path: target, assertions: snapshot.rowCount, genes: Object.keys(snapshot.genes).length, release: snapshot.provenance.release, sha256: snapshot.provenance.sha256 }));
