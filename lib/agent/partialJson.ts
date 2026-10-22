// Reads the in-progress `answer_markdown` string out of a partially streamed final_answer tool input
// (docs: progressive answer streaming). The text is PROVISIONAL display only: it is never validated, never
// persisted and never counted; the server-resolved `final` event replaces it. Pure, no imports.

const KEY = /"answer_markdown"\s*:\s*"/;

const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

// Returns the decoded text of `answer_markdown` so far, "" if its value has started but is still empty, or null if the
// key has not appeared yet. Safe on any prefix of a JSON document: an incomplete escape (`\`, `\u12`) or a lone high
// surrogate at the very end is held back until the rest arrives, and a closing quote ends the value.
export function extractAnswerMarkdown(partialJson: string): string | null {
  const m = KEY.exec(partialJson);
  if (!m) return null;
  let out = "";
  let i = m.index + m[0].length;
  while (i < partialJson.length) {
    const c = partialJson[i];
    if (c === '"') return out; // value complete
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const e = partialJson[i + 1];
    if (e === undefined) break; // dangling backslash
    if (e === "u") {
      const hex = partialJson.slice(i + 2, i + 6);
      if (hex.length < 4) break; // incomplete \uXXXX
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out; // malformed escape: stop rather than guess
      const code = parseInt(hex, 16);
      if (code >= 0xd800 && code <= 0xdbff) {
        // High surrogate: only emit once its low half is fully present.
        const low = partialJson.slice(i + 6, i + 12);
        if (low.length < 6) break;
        const lowCode = /^\\u[0-9a-fA-F]{4}$/.test(low) ? parseInt(low.slice(2), 16) : 0;
        if (lowCode >= 0xdc00 && lowCode <= 0xdfff) {
          out += String.fromCharCode(code, lowCode);
          i += 12;
          continue;
        }
        i += 6; // unpaired surrogate: drop it
        continue;
      }
      out += String.fromCharCode(code);
      i += 6;
      continue;
    }
    const mapped = SIMPLE_ESCAPES[e];
    if (mapped === undefined) return out; // invalid escape: stop
    out += mapped;
    i += 2;
  }
  return out;
}

// Provisional text hides citation markers: they are unverified until the server resolves them, and unlinked
// markers would look like broken references.
export function stripMarkersForDraft(text: string): string {
  return text
    .replace(/[ \t]?\[(?:news-\d+|\d+|\d{10}-\d{2}-\d{6})\]/g, "")
    .replace(/[ \t]?\[(?:n(?:e(?:w(?:s(?:-\d*)?)?)?)?|\d[\d-]*)?$/, ""); // a marker still arriving at the end of the text
}

// ---------------------------------------------------------------------------------------------------------------
// Structured preview of the rest of final_answer (tables, citations, follow-ups) from the same partial JSON.
// A tolerant recursive-descent parse of the accumulated text on every flush (the text is a few KB and flushes are
// throttled, so cost is negligible). Every node knows whether it is COMPLETE; only complete rows, citations and
// follow-ups are ever reported, and the server still verifies them before they leave (see previewExtras).

type PNode =
  | { t: "str"; v: string; c: boolean }
  | { t: "lit"; v: string; c: boolean }
  | { t: "arr"; items: PNode[]; c: boolean }
  | { t: "obj"; entries: [string, PNode][]; c: boolean };

const isWs = (ch: string) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r";

function parseNode(s: string, start: number): { node: PNode | null; end: number } {
  let i = start;
  while (i < s.length && isWs(s[i])) i++;
  if (i >= s.length) return { node: null, end: i };
  const ch = s[i];

  if (ch === '"') {
    let out = "";
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') return { node: { t: "str", v: out, c: true }, end: i + 1 };
      if (c !== "\\") {
        out += c;
        i++;
        continue;
      }
      const e = s[i + 1];
      if (e === undefined) break;
      if (e === "u") {
        const hex = s.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { node: { t: "str", v: out, c: false }, end: s.length };
        out += String.fromCharCode(parseInt(hex, 16)); // a lone surrogate half is fine here: rows are validated whole
        i += 6;
        continue;
      }
      const mapped = SIMPLE_ESCAPES[e];
      if (mapped === undefined) return { node: { t: "str", v: out, c: false }, end: s.length };
      out += mapped;
      i += 2;
    }
    return { node: { t: "str", v: out, c: false }, end: s.length };
  }

  if (ch === "[" || ch === "{") {
    const isArr = ch === "[";
    const items: PNode[] = [];
    const entries: [string, PNode][] = [];
    i++;
    for (;;) {
      while (i < s.length && (isWs(s[i]) || s[i] === ",")) i++;
      if (i >= s.length) break;
      if (s[i] === (isArr ? "]" : "}")) {
        i++;
        return { node: isArr ? { t: "arr", items, c: true } : { t: "obj", entries, c: true }, end: i };
      }
      if (isArr) {
        const r = parseNode(s, i);
        if (!r.node) break;
        items.push(r.node);
        i = r.end;
        if (!r.node.c) break;
      } else {
        const k = parseNode(s, i);
        if (!k.node || k.node.t !== "str") break;
        if (!k.node.c) break;
        let j = k.end;
        while (j < s.length && isWs(s[j])) j++;
        if (s[j] !== ":") break;
        const v = parseNode(s, j + 1);
        if (!v.node) {
          break;
        }
        entries.push([k.node.v, v.node]);
        i = v.end;
        if (!v.node.c) break;
      }
    }
    return { node: isArr ? { t: "arr", items, c: false } : { t: "obj", entries, c: false }, end: s.length };
  }

  // number / true / false / null: complete only once a delimiter follows, so "12" is not mistaken for "1".
  let j = i;
  while (j < s.length && !isWs(s[j]) && s[j] !== "," && s[j] !== "]" && s[j] !== "}") j++;
  return { node: { t: "lit", v: s.slice(i, j), c: j < s.length }, end: j };
}

export type PreviewParts = {
  tables: { title: string | null; columns: string[] | null; rows: string[][] }[];
  citations: { n: number; key: string }[];
  followUps: string[];
};

const entry = (n: PNode, key: string) => (n.t === "obj" ? n.entries.find(([k]) => k === key)?.[1] : undefined);
const completeStrings = (n: PNode | undefined): string[] | null =>
  n && n.t === "arr" && n.c && n.items.every((x) => x.t === "str" && x.c) ? n.items.map((x) => (x as { v: string }).v) : null;

// Completed tables (header known), completed rows, completed citations and completed follow-ups so far. Never throws.
export function extractPreviewParts(partialJson: string): PreviewParts {
  const parts: PreviewParts = { tables: [], citations: [], followUps: [] };
  try {
    const root = parseNode(partialJson, 0).node;
    if (!root || root.t !== "obj") return parts;

    const tables = entry(root, "tables");
    if (tables?.t === "arr") {
      for (const t of tables.items) {
        if (t.t !== "obj") continue;
        const title = entry(t, "title");
        const columns = completeStrings(entry(t, "columns"));
        const rowsNode = entry(t, "rows");
        const rows: string[][] = [];
        if (rowsNode?.t === "arr") {
          for (const r of rowsNode.items) {
            if (r.t === "arr" && r.c && r.items.every((x) => x.t === "str" && x.c)) rows.push(r.items.map((x) => (x as { v: string }).v));
          }
        }
        parts.tables.push({ title: title?.t === "str" && title.c ? title.v : null, columns, rows });
      }
    }

    const citations = entry(root, "citations");
    if (citations?.t === "arr") {
      for (const c of citations.items) {
        if (c.t !== "obj" || !c.c) continue;
        const n = entry(c, "n");
        const key = entry(c, "key");
        if (n?.t === "lit" && /^\d{1,3}$/.test(n.v) && key?.t === "str" && key.c) parts.citations.push({ n: Number(n.v), key: key.v });
      }
    }

    const followUps = entry(root, "follow_ups");
    if (followUps?.t === "arr") {
      for (const f of followUps.items) if (f.t === "str" && f.c) parts.followUps.push(f.v);
    }
  } catch {
    // A preview problem must never matter: report what was gathered so far.
  }
  return parts;
}
