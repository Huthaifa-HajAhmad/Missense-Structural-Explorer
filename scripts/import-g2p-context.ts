import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadG2pSnapshot, g2pSnapshotFromPayload } from '../server/services/evidence-context/g2p.ts';
import { writeSnapshotAtomically } from '../server/services/evidence-context/snapshotInstall.ts';
const args = process.argv.slice(2); const i = args.indexOf('--input');
const snapshot = i >= 0 ? g2pSnapshotFromPayload(await readFile(args[i + 1], 'utf8'), 'local-import') : await downloadG2pSnapshot();
const target = path.resolve(process.env.G2P_CONTEXT_PATH ?? 'data/g2p-context.json');
await writeSnapshotAtomically(target, snapshot);
console.log(JSON.stringify({ path: target, records: snapshot.rowCount, genes: Object.keys(snapshot.genes).length, sha256: snapshot.provenance.sha256 }));
