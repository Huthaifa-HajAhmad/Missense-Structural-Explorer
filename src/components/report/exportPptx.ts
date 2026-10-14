/**
 * exportPptx.ts — the Report document as an editable PowerPoint summary deck.
 *
 * A rendering of `ReportDocument`: the same included blocks, edited blocks marked, the same footer. It
 * is a summary, not the whole report: a title slide, the classification with its tier scale, the
 * criteria table, the evidence readings (one line per block, several slides when there are many), the
 * still-needed and summary text, and a closing slide with the limitations and the Document ID. Each
 * block's full text goes into that slide's speaker notes. Text boxes and tables are native, so the deck
 * can be edited and restyled. The `pptxgenjs` library is loaded on first use.
 *
 * pptxgenjs does not shrink text to fit, so every slide is paginated by a character budget instead.
 * The palette is the exported file's own (hex is deliberate in an exported document).
 */
import {
  exportedBlocks,
  reportBlockText,
  proseToPlain,
  type BlockKey,
  type ReportBlock,
  type ReportDocument,
  type ReportTable,
} from "../../shared/reportDocument";

const INK = "191816";
const SEC = "4D493F";
const MUTED = "6E685E";
const LINE = "D9D4C9";
const WASH = "F5F2EA";
const PATH = "B4432F";
const BEN = "3F7A55";
const CLAY = "C46849";
const FONT = "Calibri";

/** Blocks shown as one line each on the evidence slides. */
const READING_KEYS: readonly BlockKey[] = [
  "computational", "population", "splicing", "function", "structure", "stability", "assembly", "language-models",
];
const ROWS_PER_SLIDE = 6;
const CRITERIA_PER_SLIDE = 8;

/** The first paragraph of a block's text as plain words, cut at a sentence end when it is long. */
export function leadOf(text: string, max = 230): string {
  const plain = proseToPlain(text).split(/\n{2,}/)[0]?.replace(/\n/g, " ").trim() ?? "";
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (stop > 60 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const chipLine = (b: ReportBlock) =>
  [...b.chips.map(c => c.label), ...(b.edited && !b.chips.some(c => /edited/i.test(c.label)) ? ["Edited by the author"] : [])].join(" · ");

export async function buildReportPptx(doc: ReportDocument): Promise<Blob> {
  const mod: any = await import("pptxgenjs");
  const PptxGenJS = mod.default ?? mod;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = doc.title;
  pptx.author = doc.meta.preparedBy || doc.footer.app;
  pptx.subject = doc.subject;

  const blocks = exportedBlocks(doc);
  const byKey = new Map(blocks.map(b => [b.key, b] as const));
  const f = doc.footer;
  let slideNo = 0;

  const base = (title: string, chips?: string) => {
    const s = pptx.addSlide();
    slideNo += 1;
    s.background = { color: "FFFFFF" };
    s.addText(title, { x: 0.6, y: 0.4, w: 12.1, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: INK });
    if (chips) s.addText(chips, { x: 0.6, y: 1.0, w: 12.1, h: 0.35, fontFace: FONT, fontSize: 12, italic: true, color: MUTED });
    s.addShape("line", { x: 0.6, y: 1.4, w: 12.1, h: 0, line: { color: LINE, width: 1 } });
    s.addText(`${doc.title} · Research use · Document ID ${f.documentId}`, { x: 0.6, y: 7.0, w: 10.5, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED });
    s.addText(String(slideNo), { x: 12.1, y: 7.0, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED, align: "right" });
    return s;
  };

  const tableRows = (t: ReportTable) => [
    t.headers.map(h => ({ text: h.toUpperCase(), options: { bold: true, color: MUTED, fill: { color: WASH }, fontSize: 10 } })),
    ...t.rows.map(r => r.map(c => ({ text: c ?? "", options: { color: INK, fontSize: 11 } }))),
  ];

  // 1. Title
  {
    const s = pptx.addSlide();
    slideNo += 1;
    s.background = { color: "FFFFFF" };
    s.addText(doc.title, { x: 0.8, y: 2.2, w: 11.7, h: 1.2, fontFace: FONT, fontSize: 36, bold: true, color: INK });
    s.addText(f.useStatement, { x: 0.8, y: 3.5, w: 11.7, h: 0.7, fontFace: FONT, fontSize: 14, italic: true, color: MUTED });
    const who = [doc.meta.preparedBy && `Prepared by ${doc.meta.preparedBy}`, doc.meta.caseRef && `Case ${doc.meta.caseRef}`, f.generatedAt && f.generatedAt.slice(0, 10)].filter(Boolean).join(" · ");
    if (who) s.addText(who, { x: 0.8, y: 4.3, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 14, color: SEC });
    const id = byKey.get("identity");
    if (id) {
      const line = id.facts.filter(x => ["Gene", "Variant", "Protein", "Genomic"].includes(x.label)).map(x => `${x.label}: ${x.value}`).join("   ·   ");
      s.addText(line, { x: 0.8, y: 5.0, w: 11.7, h: 0.5, fontFace: FONT, fontSize: 13, color: SEC });
      s.addNotes(reportBlockText(id));
    }
  }

  // 2. Classification + 3. Criteria
  const cls = byKey.get("classification");
  if (cls?.verdict) {
    const v = cls.verdict;
    const s = base("Classification", chipLine(cls));
    const side = v.tierIndex >= 3 ? PATH : v.tierIndex <= 1 ? BEN : SEC;
    s.addText(v.text ?? "Not classified", { x: 0.6, y: 1.6, w: 12.1, h: 0.8, fontFace: FONT, fontSize: 32, bold: true, color: INK });
    v.tiers.forEach((t, i) => {
      const on = i === v.tierIndex;
      s.addShape("rect", { x: 0.6 + i * 2.44, y: 2.6, w: 2.4, h: 0.12, fill: { color: on ? side : "ECE8DF" }, line: { color: on ? side : "ECE8DF", width: 0 } });
      s.addText(t, { x: 0.6 + i * 2.44, y: 2.75, w: 2.4, h: 0.35, fontFace: FONT, fontSize: 12, bold: on, color: on ? INK : MUTED, align: "center" });
    });
    const paras = proseToPlain(cls.text).split(/\n{2,}/).slice(0, 2).map(p => p.replace(/\n/g, " ")).join("\n\n");
    s.addText(paras, { x: 0.6, y: 3.4, w: 12.1, h: 3.3, fontFace: FONT, fontSize: 16, color: SEC, valign: "top" });
    s.addText("Read with the limits & provenance slides. Full records and continued text are in speaker notes.", { x: 0.6, y: 6.8, w: 12.1, h: 0.25, fontFace: FONT, fontSize: 10, color: MUTED });
    s.addNotes(reportBlockText(cls));
    if (cls.table) {
      chunk(cls.table.rows, CRITERIA_PER_SLIDE).forEach((rows, i, all) => {
        const c = base(all.length > 1 ? `Criteria (${i + 1} of ${all.length})` : "Criteria", "Counted means the rule engine recorded it. Model proposals are listed, not counted.");
        c.addTable(tableRows({ ...cls.table!, rows }) as any, { x: 0.6, y: 1.6, w: 12.1, colW: [1.3, 1.6, 1.5, 7.7], fontFace: FONT, border: { type: "solid", color: LINE, pt: 0.5 }, valign: "middle" });
        if (cls.caption) c.addText(cls.caption, { x: 0.6, y: 6.3, w: 12.1, h: 0.6, fontFace: FONT, fontSize: 10, color: MUTED, valign: "top" });
      });
    }
  }

  // 4. Evidence readings, one line per block
  const readings = READING_KEYS.map(k => byKey.get(k)).filter((b): b is ReportBlock => Boolean(b));
  chunk(readings, ROWS_PER_SLIDE).forEach((rows, i, all) => {
    const s = base(all.length > 1 ? `Evidence readings (${i + 1} of ${all.length})` : "Evidence readings", "Read with the limits & provenance slides. Full scores and source records are in speaker notes.");
    s.addTable(
      [
        ["EVIDENCE AREA", "READING", "STATUS"].map(h => ({ text: h, options: { bold: true, color: MUTED, fill: { color: WASH }, fontSize: 10 } })),
        ...rows.map(b => [
          { text: b.title, options: { bold: true, color: INK, fontSize: 12 } },
          { text: leadOf(b.text) || "No reading.", options: { color: INK, fontSize: 11 } },
          { text: chipLine(b), options: { color: MUTED, fontSize: 10 } },
        ]),
      ] as any,
      { x: 0.6, y: 1.6, w: 12.1, colW: [2.4, 7.2, 2.5], fontFace: FONT, border: { type: "solid", color: LINE, pt: 0.5 }, valign: "middle" }
    );
    s.addNotes(rows.map(reportBlockText).join("\n\n"));
  });

  // 5. Where evidence agrees, and what is still needed
  for (const key of ["contrast", "needed"] as const) {
    const b = byKey.get(key);
    if (!b) continue;
    const s = base(b.title, chipLine(b));
    if (b.warnings.length) s.addText("Review required: read the limits & provenance slides", { x: 0.6, y: 1.15, w: 12.1, h: 0.2, fontFace: FONT, fontSize: 10, color: PATH });
    if (b.table) {
      s.addTable(tableRows(b.table) as any, { x: 0.6, y: 1.6, w: 12.1, colW: [3.6, 8.5], fontFace: FONT, border: { type: "solid", color: LINE, pt: 0.5 }, valign: "middle" });
    } else {
      s.addText(`${proseToPlain(b.text).slice(0, 1400)}${proseToPlain(b.text).length > 1400 ? "... (continued in speaker notes)" : ""}`, { x: 0.6, y: 1.6, w: 12.1, h: 5.2, fontFace: FONT, fontSize: 16, color: SEC, valign: "top" });
    }
    s.addNotes(reportBlockText(b));
  }

  // Written summary, literature and author notes
  for (const key of ["summary", "literature", "notes"] as const) {
    const b = byKey.get(key);
    if (!b) continue;
    const s = base(b.title, chipLine(b));
    if (b.warnings.length) s.addText("Review required: read the limits & provenance slides", { x: 0.6, y: 1.15, w: 12.1, h: 0.2, fontFace: FONT, fontSize: 10, color: PATH });
    s.addText(`${proseToPlain(b.text).slice(0, 1500)}${proseToPlain(b.text).length > 1500 ? "... (continued in speaker notes)" : ""}`, { x: 0.6, y: 1.6, w: 12.1, h: 4.6, fontFace: FONT, fontSize: 15, color: SEC, valign: "top" });
    if (b.caption) s.addText(b.caption, { x: 0.6, y: 6.3, w: 12.1, h: 0.6, fontFace: FONT, fontSize: 10, color: MUTED, valign: "top" });
    s.addNotes(reportBlockText(b));
  }

  // Qualifications must survive a presentation without access to speaker notes. Paginate all
  // warnings and captions; never truncate away a missing-data, freshness or authorship qualifier.
  const qualificationPages: string[] = [];
  for (const block of blocks) {
    const entries = [...block.warnings, ...(block.caption ? [block.caption] : [])];
    for (const entry of entries) {
      const words = proseToPlain(entry).split(/\s+/);
      let part = `${block.title}:`;
      for (const word of words) {
        if (part.length + word.length > 650) {
          qualificationPages.push(part);
          part = `${block.title} (continued):`;
        }
        part += ` ${word}`;
      }
      if (qualificationPages.length && qualificationPages[qualificationPages.length - 1].length + part.length < 1100) {
        qualificationPages[qualificationPages.length - 1] += `\n\n${part}`;
      } else qualificationPages.push(part);
    }
  }
  qualificationPages.forEach((text, i) => {
    const s = base(`Reading limits & provenance (${i + 1} of ${qualificationPages.length})`, "Qualifications for the included evidence and written summary");
    s.addText(text, { x: 0.6, y: 1.6, w: 12.1, h: 5.1, fontFace: FONT, fontSize: 16, color: SEC, valign: "top", breakLine: false });
    s.addNotes(text);
  });

  // Closing: limitations and the footer
  {
    const m = byKey.get("method");
    const s = base(m?.title ?? "Limitations", "Research use");
    const lines = [m ? proseToPlain(m.text) : f.useStatement];
    s.addText(`${lines.join("\n\n").slice(0, 1500)}${lines.join("\n\n").length > 1500 ? "... (continued in speaker notes)" : ""}`, { x: 0.6, y: 1.6, w: 12.1, h: 3.8, fontFace: FONT, fontSize: 14, color: SEC, valign: "top" });
    const foot = [
      f.omitted.length ? `Not included by the author: ${f.omitted.join("; ")}.` : "",
      `Document ID ${f.documentId}: a canonical content identifier; excludes export time and file formatting. Does not prove authorship.`,
      `Generated by ${f.app}${f.generatedAt ? ` on ${f.generatedAt.slice(0, 10)}` : ""}.`,
    ].filter(Boolean).join("\n");
    s.addText(foot, { x: 0.6, y: 5.5, w: 12.1, h: 1.3, fontFace: FONT, fontSize: 11, color: MUTED, valign: "top" });
    s.addShape("rect", { x: 0.6, y: 5.4, w: 0.9, h: 0.04, fill: { color: CLAY }, line: { color: CLAY, width: 0 } });
    if (m) s.addNotes(reportBlockText(m));
  }

  const out = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
