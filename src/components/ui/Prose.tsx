import React from "react";

/** "109–114", "3-10", "13–530": digits, a hyphen or en dash, digits. Both dashes are break opportunities. */
const RANGE = /(\d+[\u2013-]\d+)/g;

/**
 * Wrap each numeric range in a no-wrap span, so "helices 109–114" never ends a line on "109–" with "114" on the next.
 * Spans rather than invisible joiner characters: the DOM text, copy-paste and every test still see plain digits and dashes.
 */
function wrapRanges(text: string): React.ReactNode {
  const parts = text.split(RANGE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 === 1 ? <span key={i} className="nb">{part}</span> : part));
}

/** Map every string in a React tree through `wrapRanges`, leaving elements, numbers and structure alone. */
function mapText(node: React.ReactNode): React.ReactNode {
  if (typeof node === "string") return wrapRanges(node);
  if (Array.isArray(node)) return React.Children.map(node, mapText);
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.props.children !== undefined) {
    return React.cloneElement(node, undefined, mapText(node.props.children));
  }
  return node;
}

/**
 * A paragraph of finding text. It fills the width of its card (a measure cap left the right half of a wide card empty),
 * wraps without a one-word last line (`text-wrap: pretty`, set globally in typography-tables.css) and never splits a
 * numeric range across two lines.
 */
export function Prose({ children, ...rest }: React.ComponentPropsWithoutRef<"p">) {
  return <p {...rest}>{mapText(children)}</p>;
}
