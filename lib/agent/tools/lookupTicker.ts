// lookup_ticker: fuzzy-match a company name or ticker against the SEC company tickers file.
import Fuse from "fuse.js";
import { getTickers, type SecCompany } from "../sec";
import type { ToolDef } from "./types";

const DROP_WORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "plc",
  "holdings", "group", "the", "class", "a", "b",
]);

function normalize(s: string): string {
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !DROP_WORDS.has(w));
  // Join runs of single letters so "V F Corp" (the SEC's spelling) and "VF Corp" normalize the same.
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (w.length === 1 && prev?.length === 1 && /[a-z]/.test(w + prev)) {
      out[out.length - 1] = prev + w;
    } else out.push(w);
  }
  return out.join(" ");
}

type MatchType = "ticker" | "exact_name" | "prefix" | "fuzzy";
type Candidate = { name: string; ticker: string; cik: number; confidence: number; matchType: MatchType };

type Indexed = SecCompany & { normName: string };
let indexed: { source: SecCompany[]; rows: Indexed[]; fuse: Fuse<Indexed> } | null = null;

async function getIndex() {
  const source = await getTickers();
  if (!indexed || indexed.source !== source) {
    const rows = source.map((c) => ({ ...c, normName: normalize(c.name) }));
    const fuse = new Fuse(rows, {
      keys: ["normName"],
      includeScore: true,
      threshold: 0.25, // looser values matched "Adidas" to "Radian Group"
      ignoreLocation: true,
    });
    indexed = { source, rows, fuse };
  }
  return indexed;
}

export async function findCandidates(query: string): Promise<Candidate[]> {
  const { rows, fuse } = await getIndex();
  const rawQuery = query.trim().toLowerCase();
  const q = normalize(query);
  if (!q) return [];

  const best = new Map<number, Candidate>(); // dedupe by CIK (Under Armour has UA and UAA)
  const offer = (c: Indexed, confidence: number, matchType: MatchType) => {
    const prev = best.get(c.cik);
    if (!prev || confidence > prev.confidence) {
      best.set(c.cik, { name: c.name, ticker: c.ticker, cik: c.cik, confidence, matchType });
    }
  };

  for (const c of rows) {
    if (c.ticker.toLowerCase() === rawQuery) offer(c, 1.0, "ticker");
    else if (c.normName === q) offer(c, 0.99, "exact_name");
    else if (c.normName.startsWith(q + " ")) {
      const extraWords = c.normName.split(" ").length - q.split(" ").length;
      offer(c, Math.max(0.8, 0.9 - 0.02 * extraWords), "prefix");
    }
  }
  for (const r of fuse.search(q, { limit: 10 })) {
    offer(r.item, Math.min(0.85, 1 - (r.score ?? 1)), "fuzzy");
  }

  return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

export const lookupTicker: ToolDef<{ thought: string; query: string }> = {
  name: "lookup_ticker",
  timeoutMs: 20_000,
  definition: {
    name: "lookup_ticker",
    description:
      "Find a US public company in the SEC's company list by name or ticker. Tolerates typos. " +
      "Returns up to 3 candidates with confidence scores and a status: 'match' (one clear match), " +
      "'ambiguous' (several close matches: ask the user to choose) or 'not_found' (the company does " +
      "not file with the SEC or the name is wrong). If a 'match' has needsConfirmation true it was a fuzzy guess: " +
      "tell the user which company you assumed. Always call this before get_financials.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        thought: {
          type: "string",
          description: "One short sentence: what you need and why you are calling this tool.",
        },
        query: { type: "string", description: "Company name or ticker, e.g. 'Nike' or 'LULU'." },
      },
      required: ["thought", "query"],
      additionalProperties: false,
    },
  },
  label: (input) => `Looking up "${input.query}"`,
  async run(input, ctx) {
    const candidates = await findCandidates(input.query);
    const top = candidates[0];
    const second = candidates[1];

    let status: "match" | "ambiguous" | "not_found";
    if (!top || top.confidence < 0.5) status = "not_found";
    else if (top.confidence >= 0.8 && (!second || top.confidence - second.confidence >= 0.08)) {
      status = "match";
    } else status = "ambiguous";
    // A fuzzy guess on a very short name is unreliable ("VF Corp" once fuzzy-matched a fertility company).
    const fuzzyGuess = top?.matchType === "fuzzy";
    if (status === "match" && fuzzyGuess && normalize(input.query).replace(/ /g, "").length < 5) {
      status = "ambiguous";
    }

    if (status === "ambiguous") {
      ctx.registerAmbiguous(
        input.query,
        candidates.map((c) => ({ name: c.name, ticker: c.ticker, weak: c.matchType === "fuzzy" && c.confidence < 0.85 })),
      );
    }

    const shown = status === "not_found" ? [] : status === "match" ? [top] : candidates;
    const data = {
      status,
      query: input.query,
      needsConfirmation: status === "match" && fuzzyGuess,
      candidates: shown.map((c) => ({ ...c, confidence: Number(c.confidence.toFixed(2)) })),
    };

    let summary: string;
    if (status === "match") summary = `${fuzzyGuess ? "Fuzzy match" : "Matched"} ${top.name} (${top.ticker})`;
    else if (status === "ambiguous") {
      summary = `Ambiguous: ${shown.map((c) => `${c.name} (${c.ticker})`).join(", ")}`;
    } else summary = `No SEC filer found for "${input.query}"`;

    return { ok: true, summary, data };
  },
};
