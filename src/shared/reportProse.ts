/**
 * reportProse.ts — the small text markup the Report's drafts and editor share, and the document checksum.
 *
 * Nothing here reads evidence. The block builders write prose with `bold`, `sentence` and `joinText`;
 * renderers read it back with `parseProse` or `proseToPlain`.
 */

// ── Prose ────────────────────────────────────────────────────────────────────────────────────────

export interface ProseRun { text: string; bold: boolean }
export type ProseNode =
  | { type: "p"; runs: ProseRun[] }
  | { type: "h"; runs: ProseRun[] }
  | { type: "ul"; items: ProseRun[][] };

function runsOf(line: string): ProseRun[] {
  const runs: ProseRun[] = [];
  line.split("**").forEach((part, i) => {
    if (part) runs.push({ text: part, bold: i % 2 === 1 });
  });
  return runs;
}

/**
 * Reads the tiny markup the drafts and the editor share: blank-line paragraphs, `**bold**`, `- ` bullet
 * lines and `#` headings (the model's narrative uses them). Anything else is plain text, and nothing is
 * ever treated as HTML.
 */
export function parseProse(text: string): ProseNode[] {
  const nodes: ProseNode[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    if (lines.length === 0) continue;
    let pending: string[] = [];
    let bullets: ProseRun[][] = [];
    const flushP = () => {
      if (pending.length) nodes.push({ type: "p", runs: runsOf(pending.join(" ")) });
      pending = [];
    };
    const flushU = () => {
      if (bullets.length) nodes.push({ type: "ul", items: bullets });
      bullets = [];
    };
    for (const line of lines) {
      const heading = /^#{1,4}\s+(.*)$/.exec(line);
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      if (heading) {
        flushP(); flushU();
        nodes.push({ type: "h", runs: runsOf(heading[1]).map(r => ({ ...r, bold: true })) });
      } else if (bullet) {
        flushP();
        bullets.push(runsOf(bullet[1]));
      } else {
        flushU();
        pending.push(line.trim());
      }
    }
    flushP(); flushU();
  }
  return nodes;
}

const plainOf = (runs: ProseRun[]) => runs.map(r => r.text).join("");

/** Prose as plain text: markers removed, bullets as "- ". */
export function proseToPlain(text: string): string {
  return parseProse(text)
    .map(n => (n.type === "ul" ? n.items.map(i => `- ${plainOf(i)}`).join("\n") : plainOf(n.runs)))
    .join("\n\n");
}

/**
 * A short checksum (cyrb53, 14 hex digits) of a string. It is a change detector for the Document ID,
 * not a cryptographic digest, and the footer says what it does and does not prove.
 */
export function checksum(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, "0");
  const lo = (h1 >>> 0).toString(16).padStart(8, "0");
  return (hi + lo).slice(2);
}

// ── Writing helpers for the block builders ──────────────────────────────────────────────────────

export const bold = (s: string) => `**${s}**`;
export const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** Joins the non-empty parts with a space. */
export function joinText(parts: Array<string | null | undefined>): string {
  return parts.map(p => (p ?? "").trim()).filter(Boolean).join(" ");
}
