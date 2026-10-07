import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { genccSnapshotSchema, downloadGenccSnapshot } from './gencc.ts';
import { installOnce } from './snapshotInstall.ts';
import type { GeneDiseaseResponse } from '../../../src/shared/diseaseFrame.ts';

let cached: { path: string; mtime: number; size: number; data: ReturnType<typeof genccSnapshotSchema.parse> } | null = null;
const flights = new Map<string, Promise<ReturnType<typeof genccSnapshotSchema.parse>>>();
export async function loadGeneDiseaseContext(gene: string): Promise<GeneDiseaseResponse> {
  const target = path.resolve(process.env.GENCC_CONTEXT_PATH ?? 'data/gencc-context.json');
  try {
    const info = await stat(target).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' || !await installOnce(target, downloadGenccSnapshot)) throw error;
      return stat(target);
    });
    let data = cached?.data;
    if (!cached || cached.path !== target || cached.mtime !== info.mtimeMs || cached.size !== info.size) {
      const key = `${target}|${info.mtimeMs}|${info.size}`;
      let flight = flights.get(key);
      if (!flight) {
        flight = readFile(target, 'utf8').then(raw => {
          const data = genccSnapshotSchema.parse(JSON.parse(raw));
          cached = { path: target, mtime: info.mtimeMs, size: info.size, data }; return data;
        }).finally(() => { flights.delete(key); });
        flights.set(key, flight);
      }
      data = await flight;
    }
    return { gene, status: 'ready', frames: Object.hasOwn(data!.genes, gene) ? data!.genes[gene] : [], provenance: data!.provenance, message: null };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { gene, status: missing ? 'not-installed' : 'error', frames: [], provenance: null,
      message: missing ? 'A GenCC snapshot is not installed on this server.' : 'The installed GenCC snapshot could not be read or validated.' };
  }
}
