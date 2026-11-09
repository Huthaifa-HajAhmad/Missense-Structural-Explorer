/**
 * queue-invariants.fixture.ts — the rules a job queue table must keep (doc/STATE_MACHINES.md, section 1),
 * for the random-operation tests of `SQLiteQueue`. Test code only.
 */

export const TERMINAL = new Set(["completed", "failed"]);
export const onAgent = (claimedBy: unknown) => typeof claimedBy === "string" && claimedBy.startsWith("agent:");

/** A small seeded random number generator, so a failing run can be repeated exactly. */
export function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/** What a row must look like in each state. Returns the broken rules for one row. */
export function rowProblems(j: any): string[] {
  const problems: string[] = [];
  const agent = onAgent(j.claimed_by);
  if (j.status === "queued" && (j.started_at != null || j.claimed_by != null || j.lease_expires_at != null)) problems.push("queued row still has start, claim or lease");
  if (j.status === "running" && j.started_at == null) problems.push("running without a start time");
  if (j.status === "running" && agent && j.lease_expires_at == null) problems.push("running on a computer without a lease");
  if (j.status === "running" && !agent && j.lease_expires_at != null) problems.push("running on the server with a lease");
  if (TERMINAL.has(j.status) && j.completed_at == null) problems.push("finished without an end time");
  if (TERMINAL.has(j.status) && j.lease_expires_at != null) problems.push("finished but still leased");
  if (j.status === "completed" && j.result == null) problems.push("completed without a result");
  return problems.map((p) => `${j.id}: ${p}`);
}

/** Open claims in agent_claims must match the rows running on a computer, one for one. */
export function claimProblems(rows: any[], openClaims: any[]): string[] {
  const problems: string[] = [];
  for (const j of rows) {
    const open = openClaims.filter((c) => c.job_id === j.id);
    const running = j.status === "running" && onAgent(j.claimed_by);
    if (open.length > 1) problems.push(`${j.id}: ${open.length} open claims`);
    if (running && open.length === 0) problems.push(`${j.id}: running on a computer with no open claim`);
    if (!running && open.length > 0) problems.push(`${j.id}: open claim but the job is ${j.status}`);
  }
  return problems;
}

/**
 * Every broken rule in the queue's tables right now. `seen` remembers the final state of each job across
 * calls, so a job that leaves a final state is reported.
 */
export function tableProblems(db: any, seen: Map<string, string>): string[] {
  const rows = db.prepare("SELECT * FROM biophysical_jobs").all() as any[];
  const problems = rows.flatMap(rowProblems);
  for (const j of rows) {
    const before = seen.get(j.id);
    if (before && before !== j.status) problems.push(`${j.id}: left ${before} for ${j.status}`);
    if (TERMINAL.has(j.status)) seen.set(j.id, j.status);
  }
  problems.push(...claimProblems(rows, db.prepare("SELECT * FROM agent_claims WHERE outcome IS NULL").all()));
  return problems;
}
