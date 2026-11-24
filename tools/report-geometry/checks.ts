/**
 * Measured assertions for the Report tab (screen and rail). Each function returns a fixed number of
 * checks; `main.tsx` pins that number, so a check that silently stops running fails the run.
 */
export interface Check { name: string; pass: boolean; detail: string }

const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail });
const all = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
const one = (root: ParentNode, selector: string) => root.querySelector<HTMLElement>(selector);
const box = (el: Element) => el.getBoundingClientRect();
const nextFrame = () => new Promise<void>(r => setTimeout(() => setTimeout(() => r(), 0), 0));
const px = (n: number) => `${n.toFixed(1)}px`;

type Rgb = [number, number, number];
/** Chrome serialises color-mix() results as `color(srgb r g b)` in 0–1 units, plain colours as rgb(). */
function parseColor(value: string): Rgb | null {
  const rgb = value.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/);
  if (rgb) return Number(rgb[4] ?? 1) === 0 ? null : [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  return srgb ? [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255] : null;
}
const luminance = ([r, g, b]: Rgb) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** The colour a reader sees behind an element: the nearest ancestor with a painted background. */
function backdrop(el: HTMLElement): Rgb {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const colour = parseColor(getComputedStyle(node).backgroundColor);
    if (colour) return colour;
  }
  return [255, 255, 255];
}
function contrastOf(el: HTMLElement | null): number {
  return el ? contrast(parseColor(getComputedStyle(el).color) ?? [0, 0, 0], backdrop(el)) : 0;
}

/** The report screen: the page heading, ruled tabs and one card per section. 10 checks. */
export function screenChecks(host: HTMLElement): Check[] {
  const screen = one(host, ".rpt-screen")!;
  const cards = all(screen, ".rpt-card[data-block]");
  const card = (key: string) => one(screen, `.rpt-card[data-block="${key}"]`)!;
  const heading = one(screen, ".rpt-heading");
  const titles = cards.map(c => one(c, ".rpt-card__title")!);

  const ticked = cards.filter(c => one(c, ".rpt-tick"));
  const misplaced = ticked.filter(c => {
    const head = one(c, ".rpt-card__head")!;
    const tick = box(one(c, ".rpt-tick")!);
    const title = box(one(c, ".rpt-card__title")!);
    const others = Array.from(head.children).filter(ch => !ch.classList.contains("rpt-tick")).map(ch => box(ch).right);
    return head.lastElementChild !== one(c, ".rpt-tick") || tick.left < title.right || others.some(r => r > tick.left + 0.5);
  });

  const edge = (title: HTMLElement | null, body: HTMLElement | null) => (title && body ? Math.abs(box(title).left - box(body).left) : Infinity);
  const edges = [
    edge(one(card("classification"), ".rpt-card__title"), one(card("classification"), ".rpt-hero__figure")),
    edge(one(card("identity"), ".rpt-card__title"), one(card("identity"), ".rpt-facts dt")),
    edge(one(card("method"), ".rpt-card__title"), one(card("method"), ".rpt-prose")?.firstElementChild as HTMLElement | null),
  ];

  const tiers = one(card("classification"), ".rpt-tiers");
  const figure = one(card("classification"), ".rpt-hero__figure");
  const tierGap = tiers && figure ? Math.abs(box(tiers).left - box(figure).left) : Infinity;
  const tierInside = tiers ? box(tiers).right <= box(card("classification")).right - 16 : false;

  const buttons = all(screen, ".rpt-btn").filter(b => box(b).width > 0);
  const short = buttons.filter(b => box(b).height < 31.5);

  const notes = card("notes");
  const tabs = all(screen, ".workspace-tabs button");
  const classRows = all(card("classification"), "tbody tr");
  const folded = classRows.filter(r => r.querySelectorAll("td")[3]?.querySelector("details")).length;
  const stray = classRows.filter(r => r.querySelector("td:not(:nth-child(4)) details")).length;
  const foot = one(card("classification"), ".rpt-card__foot span");

  return [
    check("heading: one h1 with the title, no label above it and no chip that never changes",
      screen.querySelectorAll("h1").length === 1 && /evidence report/.test(one(screen, "h1")!.textContent ?? "") && !one(screen, ".rpt-heading__kicker") && !/\bDraft\b/.test(heading?.textContent ?? ""),
      `${screen.querySelectorAll("h1").length} h1`),
    check("cards: the export switch is last in the header, after the title and every action",
      ticked.length > 0 && misplaced.length === 0, `${ticked.length} cards with a switch, ${misplaced.length} out of place`),
    check("cards: each title starts on the same left edge as its body text", edges.every(e => e <= 1.5), edges.map(px).join(", ")),
    check("classification: the tier scale starts on the verdict's edge and ends inside the card padding", tierGap <= 1.5 && tierInside, `${px(tierGap)} off, inside ${tierInside}`),
    check("page: nothing scrolls sideways", screen.scrollWidth <= screen.clientWidth + 1, `${screen.scrollWidth} of ${screen.clientWidth}px`),
    check("targets: every report button is at least 32px tall", buttons.length > 0 && short.length === 0, `${buttons.length} buttons, ${short.length} short`),
    check("empty sections: the notes card offers Write and no export switch",
      !one(notes, 'input[type="checkbox"]') && all(notes, "button").some(b => b.textContent?.trim() === "Write"), "notes card"),
    check("tabs: five ruled tabs, one selected, each at least 44px tall",
      tabs.length === 5 && tabs.filter(t => t.getAttribute("aria-selected") === "true").length === 1 && tabs.every(t => box(t).height >= 43.5), `${tabs.length} tabs`),
    check("tables: the Basis column folds into a disclosure on every classification row and on no other column",
      classRows.length > 0 && folded === classRows.length && stray === 0, `${folded} of ${classRows.length} rows fold, ${stray} stray`),
    check("contrast: the note strip's text is at least 4.5:1 on the strip", contrastOf(foot) >= 4.5 && titles.length > 0, `${contrastOf(foot).toFixed(2)}:1`),
  ];
}

/** The builder rail: export bar, review status, contents and the section titles. 11 checks. */
export async function railChecks(host: HTMLElement): Promise<Check[]> {
  const rail = one(host, ".rpt-rail")!;
  const scroller = one(host, ".inspector-body")!;
  const bar = one(rail, ".rpt-export-primary")!;

  scroller.scrollTop = 400;
  await nextFrame();
  const top = box(scroller).top;
  const at = box(bar).left + 8;
  const hits = [1, 10, 18].map(dy => document.elementFromPoint(at, top + dy));
  const covered = hits.every(el => el?.closest(".rpt-export-primary"));
  const pinned = Math.abs(box(bar).top - top);

  const select = one(bar, "select")!;
  const button = one(bar, ".rpt-btn")!;
  const metas = all(rail, ".rpt-list__meta");
  const wrapped = metas.filter(m => box(m).height >= 26);
  const monoOf = (el: HTMLElement) => /mono|code/i.test(getComputedStyle(el).fontFamily);
  const wrongFace = metas.filter(m => m.hasAttribute("data-code") !== monoOf(m) && m.textContent?.trim());
  const rows = all(rail, ".rpt-list__row");
  const rowOf = (name: string) => rows.find(r => r.textContent?.includes(name))!;
  const jumps = all(rail, ".rpt-jump");
  const status = one(rail, ".rpt-status p")?.textContent ?? "";
  const titlesWithIcon = all(rail, "h3.rpt-rail-title");
  const sizes = new Set(all(rail, ".rpt-rail-title").map(t => getComputedStyle(t).fontSize));

  return [
    check("export bar: nothing scrolls into view above it", scroller.scrollTop > 100 && covered, `scrolled ${scroller.scrollTop}px, covered ${covered}`),
    check("export bar: pinned to the top of the scroll area", pinned <= 1, px(pinned)),
    check("export: the format menu and its button are the same height", Math.abs(box(select).height - box(button).height) <= 1, `${px(box(select).height)} and ${px(box(button).height)}`),
    check("rail: nothing scrolls sideways", scroller.scrollWidth <= scroller.clientWidth + 1, `${scroller.scrollWidth} of ${scroller.clientWidth}px`),
    check("contents: criterion codes stay on one line", metas.length > 0 && wrapped.length === 0, `${metas.length} notes, ${wrapped.length} wrapped`),
    check("contents: the code face is used for criterion codes and for nothing else", wrongFace.length === 0, `${wrongFace.length} wrong`),
    check("contents: a section with nothing to export has no tick, the others do",
      !one(rowOf("Author's notes"), 'input[type="checkbox"]') && Boolean(one(rowOf("Classification"), 'input[type="checkbox"]')), "notes and classification rows"),
    check("contents: jump buttons are at least 28px and rows at least 38px", jumps.length > 0 && jumps.every(j => box(j).width >= 27.5 && box(j).height >= 27.5) && rows.every(r => box(r).height >= 37.5), `${jumps.length} buttons, ${rows.length} rows`),
    check("review status: says ready or names what to read", /Ready to export|Read (this|these)/.test(status), status),
    check("section titles: one size, and each section title carries its icon", sizes.size === 1 && titlesWithIcon.length === 4 && titlesWithIcon.every(t => t.querySelector("svg")), `${sizes.size} sizes, ${titlesWithIcon.length} titles`),
    check("contrast: the contents notes are at least 4.5:1 on the rail", metas.length > 0 && metas.every(m => contrastOf(m) >= 4.5), `lowest ${Math.min(...metas.map(contrastOf)).toFixed(2)}:1`),
  ];
}

/** The screen alone in a narrow pane, where the container queries apply. 3 checks. */
export function narrowChecks(host: HTMLElement): Check[] {
  const screen = one(host, ".rpt-screen")!;
  const facts = one(screen, '[data-block="identity"] .rpt-facts')!;
  const tiers = all(screen, ".rpt-tier");
  const clipped = tiers.filter(t => t.scrollWidth > t.clientWidth + 1);
  return [
    check("narrow: nothing scrolls sideways", screen.scrollWidth <= screen.clientWidth + 1, `${screen.scrollWidth} of ${screen.clientWidth}px`),
    check("narrow: the identity facts fall to one column", getComputedStyle(facts).gridTemplateColumns.trim().split(/\s+/).length === 1, getComputedStyle(facts).gridTemplateColumns),
    check("narrow: every tier label fits its step", tiers.length === 5 && clipped.length === 0, `${tiers.length} steps, ${clipped.length} clipped`),
  ];
}
