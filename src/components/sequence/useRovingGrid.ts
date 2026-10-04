import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * One tab stop for a grid of buttons, arrow keys inside it. Cells carry `data-rc="row:col"`; one may
 * carry `data-entry` to be where Tab lands first (the queried cell). The focus window holds about
 * 700 cells, and a tab stop on each made the keyboard unusable.
 *
 * Driven from the DOM so it holds for any markup: after every render exactly one cell is tabbable,
 * the one last focused, else the entry cell, else the first.
 */
export function useRovingGrid<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const active = useRef<string | null>(null);

  const cells = useCallback(() => Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-rc]") ?? []), []);
  const settle = useCallback(
    (keep: HTMLElement | undefined) => {
      for (const c of cells()) c.tabIndex = c === keep ? 0 : -1;
    },
    [cells]
  );

  useLayoutEffect(() => {
    const all = cells();
    if (all.length === 0) return;
    settle(all.find((c) => c.dataset.rc === active.current) ?? all.find((c) => c.hasAttribute("data-entry")) ?? all[0]);
  });

  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!el.dataset?.rc) return;
      active.current = el.dataset.rc;
      settle(el);
    },
    [settle]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const rc = el.dataset?.rc;
      if (!rc) return;
      const [r, c] = rc.split(":").map(Number);
      const all = cells();
      const coords = all.map((x) => x.dataset.rc!.split(":").map(Number) as [number, number]);
      const maxC = Math.max(...coords.map((x) => x[1]));
      const maxR = Math.max(...coords.map((x) => x[0]));
      const step: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      let next: HTMLElement | null = null;
      const find = (rr: number, cc: number) => ref.current?.querySelector<HTMLElement>(`[data-rc="${rr}:${cc}"]`) ?? null;
      if (e.key in step) {
        const [dr, dc] = step[e.key];
        let rr = r + dr;
        let cc = c + dc;
        // Skip gaps (a residue with no codon in the lane) rather than stopping at them.
        while (rr >= 0 && rr <= maxR && cc >= 0 && cc <= maxC && !(next = find(rr, cc))) {
          rr += dr;
          cc += dc;
        }
      } else if (e.key === "Home") next = find(r, 0) ?? all.find((x) => x.dataset.rc!.startsWith(`${r}:`)) ?? null;
      else if (e.key === "End") {
        for (let cc = maxC; cc >= 0 && !next; cc--) next = find(r, cc);
      } else return;
      e.preventDefault();
      next?.focus();
    },
    [cells]
  );

  return { ref, onFocus, onKeyDown };
}
