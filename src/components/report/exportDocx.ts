/**
 * exportDocx.ts — the Report document as an editable Word file.
 *
 * A rendering of `ReportDocument`, like the html and text exports: the same included blocks, edited
 * blocks marked, the same footer. The `docx` library is loaded on first use so it is not part of the
 * app's initial bundle. Headings, tables and page numbers are real Word structures, so the file can be
 * edited, restyled and reflowed. The tier ladder is a one-row table whose active cell is shaded.
 *
 * The palette is the exported file's own (hex is deliberate in an exported document).
 */
import {
  exportedBlocks,
  parseProse,
  type ProseRun,
  type ReportBlock,
  type ReportDocument,
  type ReportTable,
} from "../../shared/reportDocument";

const INK = "191816";
const MUTED = "6E685E";
const LINE = "D9D4C9";
const WASH = "F5F2EA";
const ACTIVE = "4D493F";
const PATH = "B4432F";
const BEN = "3F7A55";

export async function buildReportDocx(doc: ReportDocument): Promise<Blob> {
  const d = await import("docx");
  const {
    AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, ShadingType,
    Table, TableCell, TableRow, TextRun, WidthType,
  } = d;

  const runs = (rs: ProseRun[]) => rs.map(r => new TextRun({ text: r.text, bold: r.bold }));

  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const hair = { style: BorderStyle.SINGLE, size: 4, color: LINE };

  const prose = (text: string): InstanceType<typeof Paragraph>[] =>
    parseProse(text).flatMap(n => {
      if (n.type === "ul") {
        return n.items.map(it => new Paragraph({ children: runs(it), bullet: { level: 0 }, spacing: { after: 60 } }));
      }
      if (n.type === "h") {
        return [new Paragraph({ children: runs(n.runs), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } })];
      }
      return [new Paragraph({ children: runs(n.runs), spacing: { after: 120 } })];
    });

  const factsTable = (b: ReportBlock) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: none, bottom: hair, left: none, right: none, insideHorizontal: hair, insideVertical: none },
      rows: b.facts.map(
        f =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 30, type: WidthType.PERCENTAGE },
                borders: { top: none, bottom: hair, left: none, right: none },
                children: [new Paragraph({ children: [new TextRun({ text: f.label, color: MUTED, size: 20 })] })],
              }),
              new TableCell({
                width: { size: 70, type: WidthType.PERCENTAGE },
                borders: { top: none, bottom: hair, left: none, right: none },
                children: [new Paragraph({ children: [new TextRun({ text: f.value, color: INK, font: f.mono ? "Consolas" : undefined, size: 21 })] })],
              }),
            ],
          })
      ),
    });

  const dataTable = (t: ReportTable) => {
    const num = new Set(t.numeric ?? []);
    const cell = (text: string, c: number, head: boolean) =>
      new TableCell({
        borders: { top: none, left: none, right: none, bottom: hair },
        shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: WASH } : undefined,
        children: [
          new Paragraph({
            alignment: num.has(c) ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({ text: head ? text.toUpperCase() : text, bold: head, color: head ? MUTED : INK, size: head ? 17 : 20, font: !head && num.has(c) ? "Consolas" : undefined })],
          }),
        ],
      });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: t.headers.map((h, c) => cell(h, c, true)) }),
        ...t.rows.map(r => new TableRow({ cantSplit: true, children: r.map((v, c) => cell(v ?? "", c, false)) })),
      ],
    });
  };

  const ladder = (b: ReportBlock) => {
    const v = b.verdict!;
    const side = v.tierIndex >= 3 ? PATH : v.tierIndex <= 1 ? BEN : ACTIVE;
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: v.tiers.map((t, i) =>
            new TableCell({
              borders: { top: { style: BorderStyle.SINGLE, size: 24, color: i === v.tierIndex ? side : "ECE8DF" }, bottom: none, left: none, right: none },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: t, bold: i === v.tierIndex, color: i === v.tierIndex ? INK : MUTED, size: 18 })],
                }),
              ],
            })
          ),
        }),
      ],
    });
  };

  const spacer = () => new Paragraph({ spacing: { after: 60 }, children: [] });

  const blockChildren = (b: ReportBlock): Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> => {
    const out: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
    out.push(new Paragraph({ text: b.title, heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 320, after: 80 } }));
    const chipText = [...b.chips.map(c => c.label), ...(b.edited && !b.chips.some(c => /edited/i.test(c.label)) ? ["Edited by the author"] : [])].join("  ·  ");
    if (chipText) out.push(new Paragraph({ children: [new TextRun({ text: chipText, color: MUTED, size: 18, italics: true })], spacing: { after: 100 }, keepNext: true }));
    if (b.verdict) {
      out.push(new Paragraph({ children: [new TextRun({ text: b.verdict.text ?? "Not classified", bold: true, size: 40, color: INK })], spacing: { after: 100 }, keepNext: true }));
      out.push(ladder(b), spacer());
    }
    if (b.facts.length) out.push(factsTable(b), spacer());
    if (b.text.trim()) out.push(...prose(b.text));
    if (b.table) out.push(dataTable(b.table), spacer());
    if (b.caption) out.push(new Paragraph({ children: [new TextRun({ text: b.caption, color: MUTED, size: 18 })], spacing: { after: 80 } }));
    return out;
  };

  const f = doc.footer;
  const head: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE, spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: f.useStatement, color: MUTED, italics: true, size: 21 })], spacing: { after: 80 } }),
  ];
  if (doc.meta.preparedBy) head.push(new Paragraph({ children: [new TextRun({ text: `Prepared by: ${doc.meta.preparedBy}`, color: MUTED, size: 21 })] }));
  if (doc.meta.caseRef) head.push(new Paragraph({ children: [new TextRun({ text: `Case reference: ${doc.meta.caseRef}`, color: MUTED, size: 21 })] }));

  const end: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 12, color: LINE, space: 6 } },
      spacing: { before: 400, after: 60 },
      children: [new TextRun({ text: `Generated by ${f.app}${f.generatedAt ? ` on ${f.generatedAt.slice(0, 10)}` : ""}.`, color: MUTED, size: 18 })],
    }),
  ];
  if (f.omitted.length) end.push(new Paragraph({ children: [new TextRun({ text: `Not included by the author: ${f.omitted.join("; ")}.`, color: MUTED, size: 18 })], spacing: { after: 60 } }));
  end.push(new Paragraph({ children: [new TextRun({ text: `Document ID ${f.documentId}: a checksum of the report text; it detects later changes and does not prove authorship.`, color: MUTED, size: 18 })] }));

  const file = new Document({
    creator: doc.meta.preparedBy || f.app,
    title: doc.title,
    description: f.useStatement,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: "4D493F" } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 44, bold: true, color: INK } },
        { id: "Heading2", name: "heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, color: MUTED, allCaps: true } },
        { id: "Heading3", name: "heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: INK } },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${doc.title} · Research use · Document ID ${f.documentId} · Page `, color: MUTED, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
                  new TextRun({ text: " of ", color: MUTED, size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: MUTED, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children: [...head, ...exportedBlocks(doc).flatMap(blockChildren), ...end],
      },
    ],
  });
  return Packer.toBlob(file);
}
