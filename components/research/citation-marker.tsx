import type { ReactNode } from "react";

export const MARKER = /\[(\d+)\]/g;

const markerClass =
  "ml-0.5 rounded-sm px-0.5 text-[11px] text-accent transition-colors duration-150 hover:bg-accent-soft hover:text-accent-hover";

export function Marker({ n }: { n: string }) {
  return (
    <sup>
      <a href={`#source-${n}`} className={markerClass} aria-label={`Source ${n}`}>
        [{n}]
      </a>
    </sup>
  );
}

// Plain strings (table cells) with [n] markers become linked markers. A marker with no matching
// source is left out of the link set by the caller and printed as plain text.
export function renderWithMarkers(text: string, known: Set<string>): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    const idx = m.index ?? 0;
    if (!known.has(m[1])) continue;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(<Marker key={idx} n={m[1]} />);
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Turn "[1]" markers in markdown into links to the sources list; unknown ones stay plain text.
export function linkMarkers(markdown: string, known: Set<string>): string {
  return markdown.replace(MARKER, (m, n) => (known.has(n) ? `[\\[${n}\\]](#source-${n})` : m));
}

export const markdownMarkerClass = markerClass;
