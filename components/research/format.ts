// Presentation helpers only. They change how a string is laid out, never what it says.

const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;

// "2024-05-31" -> "May 31, 2024". Anything that is not an ISO date is returned unchanged.
export function formatDate(text: string): string {
  return text.replace(ISO_DATE, (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  });
}

// "FY2024 (ended 2024-05-31)" -> { main: "FY2024", secondary: "ended May 31, 2024" }. A trailing
// parenthetical that holds one period end becomes a muted second line. Multi-company labels such as
// "FY2024 (NKE 2024-05-31; LULU 2025-02-02)" and plain text are left whole.
export function splitPeriod(text: string): { main: string; secondary?: string } {
  const m = text.match(/^(.*?)\s*\(([^()]*\d{4}-\d{2}-\d{2}[^()]*)\)\s*$/);
  if (!m || !m[1].trim() || m[2].includes(";")) return { main: text };
  return { main: m[1].trim(), secondary: formatDate(m[2].trim()) };
}

// Cells that mean "no value" are shown as a muted dash (the original text stays as the tooltip).
const MISSING =
  /^(n\/?a|n\.a\.|—|–|-|unavailable|missing|data missing|no data|not (yet )?(reported|available)|not disclosed)(?!\w)/i;
// Short cells only, so a real value or sentence that merely starts with one of these words is never replaced.
export const isMissingCell = (text: string) => text.trim().length <= 90 && MISSING.test(text.trim());
