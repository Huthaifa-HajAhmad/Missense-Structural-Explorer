// Operator smoke check: exercise the same keyless GETs as the deployed tabs.
// No credentials, patient data, or snapshot installation are performed here.
const [origin, gene = 'RGS9'] = process.argv.slice(2);
if (!origin || !/^https?:\/\//.test(origin) || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,49}$/.test(gene)) {
  throw new Error('Usage: node scripts/check-evidence-context.mjs <http(s) origin> [gene symbol]');
}
let failed = false;
for (const [suffix, collection] of [['', 'frames'], ['/expression', 'tissues'], ['/development', 'observations']]) {
  const url = new URL('/api/v1/evidence-context/' + encodeURIComponent(gene) + suffix, origin);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (data.gene !== gene || data.status !== 'ready' || !data[collection]?.length || !data.provenance?.sha256) {
      throw new Error('Source state: ' + data.status + '; usable evidence/provenance missing');
    }
    if (!suffix && data.mechanismContext?.status !== 'ready') throw new Error('G2P source state: ' + data.mechanismContext?.status);
    console.log(JSON.stringify({ path: url.pathname, state: data.status, count: data[collection].length, release: data.provenance.release, recordedAt: data.provenance.retrievedAt }));
  } catch (error) { failed = true; console.error(url.pathname + ': ' + error.message); }
}
if (failed) process.exitCode = 1;
