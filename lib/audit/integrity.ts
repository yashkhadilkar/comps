// Comparison integrity (V2): deterministic checks over already-retrieved SEC facts, and the reducer that turns them
// into READY / REVIEW / BLOCKED. Pure: no network, no model. The comparability status (types.ts) is a separate
// dimension; nothing here changes it. A check can PASS only when its evidence is present; otherwise NOT_ASSESSED.
import { evaluateExpression } from "../agent/tools/calculate";
import { checkSeverity, reduceReadiness, sourceBasisOf } from "./readiness";
import { formatMoney } from "../agent/tools/getFinancials";
import type {
  AuditMetricId,
  AuditValue,
  CheckReference,
  CheckStatus,
  IntegrityCheck,
  IntegrityCheckId,
  MetricIntegrity,
  Readiness,
  SourceBasis,
} from "./types";

export { checkSeverity, reduceReadiness, sourceBasisOf };

const DAY_MS = 24 * 60 * 60 * 1000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
export const inclusiveDays = (start: string, end: string) => days(start, end) + 1;

// Heuristics, documented in docs/BIG_AUDIT.md (A25) and tested in scripts/try-integrity.ts. Two full-year windows
// are judged by how much of the longer one they share, not by the year-end gap alone.
export const MATERIAL_REVISION = 0.01; // a later filing changing a period's value by >= 1% is a material signal
export const SAME_END_DAYS = 7; // 52/53-week calendars end a few days apart: same period
export const INFO_OVERLAP = 0.7; // >= 70% shared days: ordinary fiscal-calendar difference, informational
export const CAUTION_OVERLAP = 0.5; // 50-70%: material timing difference; below half: different periods
export const ANNUAL_MIN_DAYS = 350;
export const ANNUAL_MAX_DAYS = 381;
export const DURATION_DIFF_DAYS = 5; // a 52- vs 53-week year differs by 7 days; calendar vs 52-week by 1-2
export const CONTIGUOUS_DAYS = 7; // next fiscal year starts within a week of the previous one ending

// Concept pairs that are not like-for-like even though both are valid GAAP lines. Established by the us-gaap
// taxonomy definitions, so a FAIL here is a verified concept conflict, not a guess.
export const DEFINITION_CONFLICTS: { metric: AuditMetricId; tags: [string, string]; note: string; action: string }[] = [
  {
    metric: "revenue",
    tags: ["RevenueFromContractWithCustomerIncludingAssessedTax", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    note: "One company reports revenue including assessed (excise/sales) taxes and the other excluding them.",
    action: "Use the filings' excise/sales tax disclosure to put both on the same basis before comparing revenue.",
  },
  {
    metric: "net_income",
    tags: ["ProfitLoss", "NetIncomeLoss"],
    note: "One company's figure is ProfitLoss (includes noncontrolling interests) and the other's is NetIncomeLoss (attributable to the parent).",
    action: "Find net income attributable to noncontrolling interests in the filing; subtract it, or confirm it is zero, before comparing.",
  },
];

export const findConflict = (metric: AuditMetricId, a: string, b: string) =>
  a === b ? undefined : DEFINITION_CONFLICTS.find((c) => c.metric === metric && c.tags.includes(a) && c.tags.includes(b));

// ---- Check construction and reduction -----------------------------------------------------------------------------

type CheckInput = Omit<IntegrityCheck, "severity" | "scope" | "ticker" | "evidenceIds" | "action"> &
  Partial<Pick<IntegrityCheck, "scope" | "ticker" | "evidenceIds" | "action">>;

export function makeCheck(c: CheckInput): IntegrityCheck {
  return {
    scope: "comparison",
    ticker: null,
    evidenceIds: [],
    action: null,
    ...c,
    severity: checkSeverity(c.status, c.critical),
  };
}

const RANK: Record<CheckStatus, number> = { NOT_APPLICABLE: 0, PASS: 1, INFO: 2, NOT_ASSESSED: 3, CAUTION: 4, FAIL: 5 };

const READINESS_RANK: Record<Readiness, number> = { READY: 0, REVIEW: 1, BLOCKED: 2 };
export const worstReadiness = (...r: Readiness[]): Readiness => r.reduce((a, b) => (READINESS_RANK[b] > READINESS_RANK[a] ? b : a), "READY");

// Combines the same check from several inputs (operating margin inherits revenue's and operating income's checks).
export function mergeChecks(checks: IntegrityCheck[], prefixes: string[]): IntegrityCheck {
  const worst = checks.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
  // The finding names only the inputs that set the merged status.
  const drivers = checks.map((c, i) => ({ c, p: prefixes[i] })).filter((x) => x.c.status === worst.status);
  const distinct = drivers.length < checks.length || new Set(drivers.map((x) => x.c.finding)).size > 1;
  return {
    ...worst,
    finding: distinct ? drivers.map((x) => `${x.p}: ${x.c.finding}`).join(" ") : worst.finding,
    critical: checks.some((c) => c.critical),
    severity: checkSeverity(worst.status, checks.some((c) => c.critical)),
    evidenceIds: [...new Set(checks.flatMap((c) => c.evidenceIds))],
    references: dedupeRefs(checks.flatMap((c) => c.references ?? [])),
  };
}

const dedupeRefs = (refs: CheckReference[]) => refs.filter((r, i) => refs.findIndex((x) => x.accession === r.accession) === i);

// ---- Comparison checks ----------------------------------------------------------------------------------------------

type Side = { ticker: string; start: string | null; end: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function periodAlignmentCheck(a: Side, b: Side, evidenceIds: string[]): IntegrityCheck {
  const shift = Math.abs(days(a.end, b.end));
  const ends = `${a.ticker} ended ${a.end}, ${b.ticker} ended ${b.end}`;
  const base = { id: "period_alignment" as const, critical: true, title: "Fiscal period alignment", evidenceIds };
  if (shift <= SAME_END_DAYS) {
    return makeCheck({ ...base, status: "PASS", finding: `Fiscal years end ${shift} day${shift === 1 ? "" : "s"} apart (${ends}).`, implication: "Same annual period." });
  }
  let share: number;
  let how: string;
  if (a.start && b.start) {
    const overlap = Math.max(0, days(a.start > b.start ? a.start : b.start, a.end < b.end ? a.end : b.end) + 1);
    share = overlap / Math.max(inclusiveDays(a.start, a.end), inclusiveDays(b.start, b.end));
    how = `the windows share ${overlap} days (${pct(share)} of the longer period)`;
  } else {
    share = Math.max(0, 365 - shift) / 365;
    how = `assuming 12-month windows they share about ${pct(share)} of their days (period starts not available)`;
  }
  const finding = `Fiscal years end ${shift} days apart (${ends}); ${how}.`;
  if (share >= INFO_OVERLAP) {
    return makeCheck({
      ...base,
      status: "INFO",
      finding,
      implication: "An ordinary fiscal-calendar difference: usable for annual benchmarking. Disclose the different windows; seasonality and macro conditions are not identical.",
    });
  }
  if (share >= CAUTION_OVERLAP) {
    return makeCheck({
      ...base,
      status: "CAUTION",
      finding,
      implication: "The windows overlap only partly, so timing can drive part of any difference. Qualify the comparison.",
      action: "Consider whether a trailing-twelve-month view on matched quarters is needed; otherwise state the window difference.",
    });
  }
  return makeCheck({
    ...base,
    status: "FAIL",
    finding,
    implication: "The closest available annual periods cover mostly different months; they are not the same economic period.",
    action: "Use matched periods (for example trailing twelve months from quarterly filings) before comparing.",
  });
}

const weeksNote = (d: number) => (d === 364 ? " (52 weeks)" : d >= 369 && d <= 373 ? " (53 weeks)" : "");

export function periodDurationCheck(sides: Side[], evidenceIds: string[]): IntegrityCheck {
  const base = { id: "period_duration" as const, critical: true, title: "Period length", evidenceIds };
  const unknown = sides.filter((s) => !s.start).map((s) => s.ticker);
  if (unknown.length) {
    return makeCheck({
      ...base,
      status: "NOT_ASSESSED",
      finding: `Period start date not available for ${unknown.join(", ")}, so period length was not verified.`,
      implication: "A full-year period is assumed from the annual 10-K selection but not confirmed.",
      action: "Confirm in the 10-K that each figure covers a full fiscal year.",
    });
  }
  const lens = sides.map((s) => ({ ticker: s.ticker, d: inclusiveDays(s.start!, s.end), start: s.start!, end: s.end }));
  const text = lens.map((l) => `${l.ticker} ${l.start} to ${l.end} = ${l.d} days${weeksNote(l.d)}`).join("; ");
  const odd = lens.filter((l) => l.d < ANNUAL_MIN_DAYS || l.d > ANNUAL_MAX_DAYS);
  if (odd.length) {
    return makeCheck({
      ...base,
      status: "FAIL",
      finding: `Not a full-year period: ${text}.`,
      implication: "A short or long period cannot be compared with a full fiscal year.",
      action: "Use a full-year period for each company.",
    });
  }
  const spread = Math.max(...lens.map((l) => l.d)) - Math.min(...lens.map((l) => l.d));
  if (spread >= DURATION_DIFF_DAYS) {
    return makeCheck({
      ...base,
      status: "CAUTION",
      finding: `Period lengths differ: ${text}.`,
      implication: "The longer period includes about one extra week of activity. No normalization is applied, and none is estimated.",
      action: "Check the 10-K for the extra week's disclosed impact before comparing totals.",
    });
  }
  return makeCheck({ ...base, status: "PASS", finding: `Both are full-year periods: ${text}.`, implication: "Comparable period length." });
}

export function definitionCheck(metric: AuditMetricId, a: { ticker: string; tag: string | null }, b: { ticker: string; tag: string | null }, evidenceIds: string[]): IntegrityCheck {
  const base = { id: "definition" as const, critical: true, title: "Metric definition (XBRL concept)", evidenceIds };
  if (!a.tag || !b.tag) {
    return makeCheck({ ...base, status: "NOT_ASSESSED", finding: "No XBRL concept recorded for at least one value.", implication: "Definition equivalence cannot be checked." });
  }
  const conflict = findConflict(metric, a.tag, b.tag);
  if (conflict) {
    return makeCheck({
      ...base,
      status: "FAIL",
      finding: `${a.ticker}: us-gaap:${a.tag}; ${b.ticker}: us-gaap:${b.tag}. ${conflict.note}`,
      implication: "Known concept conflict: the two figures measure different things.",
      action: conflict.action,
    });
  }
  if (a.tag !== b.tag) {
    return makeCheck({
      ...base,
      status: "CAUTION",
      finding: `Different XBRL concepts: ${a.ticker} us-gaap:${a.tag}, ${b.ticker} us-gaap:${b.tag}.`,
      implication: "Both are US GAAP lines for this metric, but Comps has no verified equivalence for this pair. A tag difference is a review signal, not proof of incompatibility.",
      action: "Open both income statements and confirm the lines cover the same scope (for example, whether other revenue or financing income is included).",
    });
  }
  return makeCheck({
    ...base,
    status: "PASS",
    finding: `Both report us-gaap:${a.tag}.`,
    implication: "Same XBRL concept (a tag-policy match only). Company accounting policies behind the line are not compared.",
  });
}

export function currencyCheck(values: AuditValue[], nonUsd: { ticker: string; units: string[] }[], evidenceIds: string[]): IntegrityCheck {
  const base = { id: "currency" as const, critical: true, title: "Currency and unit", evidenceIds };
  if (nonUsd.length) {
    return makeCheck({
      ...base,
      status: "FAIL",
      finding: `${nonUsd.map((n) => `${n.ticker} reports this metric in ${n.units.join(", ")}`).join("; ")}, not USD.`,
      implication: "No documented FX rate is available, so values in different currencies are not combined.",
      action: "Obtain a documented FX rate and date, or compare in the reporting currency outside Comps.",
    });
  }
  if (values.some((v) => (v.reportedValue ?? v.normalizedValue) === null)) {
    return makeCheck({ ...base, status: "NOT_ASSESSED", finding: "Currency not established for a missing value.", implication: "Checked only once both values exist." });
  }
  return makeCheck({ ...base, status: "PASS", finding: "Both values are USD facts.", implication: "No conversion needed." });
}

export function evidenceCheck(
  values: AuditValue[],
  missing: { ticker: string; reason: string }[],
  excluded: string[], // tickers whose figure exists only in a non-USD unit (handled by the currency check)
  evidenceIds: string[],
): IntegrityCheck {
  const base = { id: "evidence" as const, critical: true, title: "Source evidence", evidenceIds };
  if (missing.length) {
    return makeCheck({
      ...base,
      status: "FAIL",
      finding: missing.map((m) => m.reason).join(" "),
      implication: "A required figure is unavailable in the SEC structured data retrieved. This is a data-coverage gap; it does not show that the filing omits the information.",
      action: "Locate the figure in the 10-K itself, or exclude this metric from the comparison.",
    });
  }
  if (excluded.length) {
    return makeCheck({
      ...base,
      status: "NOT_ASSESSED",
      finding: `${excluded.join(", ")}: not retrieved, because only USD facts are used.`,
      implication: "The figure exists in another currency; see the currency check.",
    });
  }
  const unsourced = values.filter((v) => (v.reportedValue ?? v.normalizedValue) !== null && v.evidence.length === 0).map((v) => v.ticker);
  if (unsourced.length) {
    return makeCheck({
      ...base,
      status: "FAIL",
      finding: `No filing link for ${unsourced.join(", ")}.`,
      implication: "An unsourced figure cannot support a conclusion.",
      action: "Re-run the audit; if it persists, locate the filing manually.",
    });
  }
  return makeCheck({ ...base, status: "PASS", finding: "Each value maps to a 10-K accession number.", implication: "Source verified (not the accounting policy behind it)." });
}

const BASIS_TEXT: Record<SourceBasis, string> = { DIRECT_REPORTED: "reported directly", DERIVED: "derived by formula", UNAVAILABLE: "unavailable" };

// Provenance is transparency, not a penalty: a verified derivation of the same concept is as usable as a reported fact.
export function provenanceCheck(values: AuditValue[], evidenceIds: string[]): IntegrityCheck {
  const base = { id: "provenance" as const, critical: false, title: "Source basis", evidenceIds };
  const bases = values.map((v) => ({ ticker: v.ticker, basis: sourceBasisOf(v) }));
  const text = bases.map((b) => `${b.ticker} ${BASIS_TEXT[b.basis]}`).join(", ");
  if (bases.some((b) => b.basis === "UNAVAILABLE")) {
    return makeCheck({ ...base, status: "NOT_ASSESSED", finding: `${text}.`, implication: "Provenance compared only when both values exist." });
  }
  if (new Set(bases.map((b) => b.basis)).size > 1) {
    return makeCheck({ ...base, status: "INFO", finding: `${text}.`, implication: "Provenance differs; the derivation is verified, so this alone does not limit the comparison." });
  }
  return makeCheck({ ...base, status: "PASS", finding: `${text}.`, implication: "Same source basis." });
}

// ---- Revision signals (P1) ----------------------------------------------------------------------------------------
// The audited value is always the most recently filed one (get_financials' selection, unchanged). Earlier filings of
// the same concept and exact period are compared with it. A difference is a REVISION SIGNAL: it can come from a
// restatement, a reclassification or a definition change, and Comps does not establish which.

export type PriorReport = { accession: string; filed: string; form: string; value: number; url: string };

type RevisionSide = { ticker: string; row: { value: number; filed: string; fiscalYear: number; priorReports?: PriorReport[] } | null };

export function revisionCheck(label: string, sides: RevisionSide[], evidenceIds: string[]): IntegrityCheck | null {
  const withRows = sides.filter((s): s is RevisionSide & { row: NonNullable<RevisionSide["row"]> } => !!s.row);
  if (!withRows.length || withRows.some((s) => !s.row.priorReports)) return null; // metadata not retrieved: fixed NOT_ASSESSED
  const base = { id: "revisions" as const, critical: false, title: "Revisions and restatements", evidenceIds };
  const signals: { text: string; material: boolean; refs: CheckReference[] }[] = [];
  const unchanged: string[] = [];
  const firstReport: string[] = [];
  for (const { ticker, row } of withRows) {
    const prior = row.priorReports!;
    if (!prior.length) {
      firstReport.push(ticker);
      continue;
    }
    const changed = prior.filter((p) => p.value !== row.value).sort((x, y) => (x.filed < y.filed ? -1 : 1));
    if (!changed.length) {
      unchanged.push(`${ticker} (${prior.length} earlier filing${prior.length === 1 ? "" : "s"})`);
      continue;
    }
    const orig = changed[0];
    const delta = evaluateExpression(`${row.value} - ${orig.value}`);
    const rel = orig.value === 0 ? { error: "zero base" } : evaluateExpression(`(${row.value} - ${orig.value}) / ${Math.abs(orig.value)} * 100`);
    const d = "error" in delta ? null : delta.result;
    const r = "error" in rel ? null : rel.result;
    signals.push({
      text: `REVISION SIGNAL ${ticker} FY${row.fiscalYear} ${label.toLowerCase()}: ${formatMoney(orig.value)} in the ${orig.form} filed ${orig.filed}, ${formatMoney(row.value)} in the latest filing (filed ${row.filed})${d !== null ? `, a change of ${formatMoney(d)}${r !== null ? ` (${r >= 0 ? "+" : ""}${r.toFixed(1)}%)` : ""}` : ""}.`,
      material: r === null || Math.abs(r) >= MATERIAL_REVISION * 100,
      refs: [{ label: `${ticker} ${orig.form} (filed ${orig.filed}), earlier value`, url: orig.url, accession: orig.accession }],
    });
  }
  const tail = [
    unchanged.length ? `Same value in earlier filings: ${unchanged.join(", ")}.` : "",
    firstReport.length ? `No earlier filing reports this period under the same XBRL concept for ${firstReport.join(", ")}, so revisions are not assessed there.` : "",
  ].filter(Boolean);
  if (signals.length) {
    const material = signals.some((s) => s.material);
    return makeCheck({
      ...base,
      status: material ? "CAUTION" : "INFO",
      finding: [...signals.map((s) => s.text), ...tail].join(" "),
      implication: "The latest filed value is used. The reason for the change (restatement, reclassification or definition change) is not established by Comps.",
      references: dedupeRefs(signals.flatMap((s) => s.refs)),
      action: material ? "Read the latest 10-K's note on revised or recast prior-period amounts, and make sure any external figure you compare with uses the same version." : null,
    });
  }
  if (firstReport.length === withRows.length) {
    return makeCheck({ ...base, status: "NOT_ASSESSED", finding: tail.join(" "), implication: "No candidate history: this is not a finding of no revisions." });
  }
  return makeCheck({
    ...base,
    status: firstReport.length ? "NOT_ASSESSED" : "PASS",
    finding: tail.join(" "),
    implication: firstReport.length ? "Partly assessed: no candidate history for one company." : "No revision signal among the earlier filings retrieved (dimensional or segment facts are not compared).",
  });
}

// Fixed coverage limits, listed on every metric so nothing out of scope reads as passed.
export function coverageChecks(revisionsAssessed: IntegrityCheck | null): IntegrityCheck[] {
  return [
    revisionsAssessed ??
      makeCheck({
        id: "revisions",
        critical: false,
        status: "NOT_ASSESSED",
        title: "Revisions and restatements",
        finding: "Only the most recently filed value for each period is used; earlier filed versions were not compared.",
        implication: "A revision would not be detected. This is a coverage limit, not a finding of no revisions.",
      }),
    makeCheck({
      id: "accounting_policy",
      critical: false,
      status: "NOT_ASSESSED",
      title: "Accounting policy and footnotes",
      finding: "Revenue recognition, segment, one-time item and footnote policies were not compared.",
      implication: "Passing checks do not establish full economic comparability.",
    }),
  ];
}

// ---- Same-company history (multi-year series) ---------------------------------------------------------------------

export type SeriesRow = { fiscalYear: number; start: string | null; end: string; tag: string; accession: string };
export type ShortPeriod = { start: string; end: string; days: number; accession: string; form: string; url: string };

export function seriesChecks(
  ticker: string,
  rows: SeriesRow[],
  years: number[],
  shortPeriods: ShortPeriod[],
  refFor: (accession: string) => CheckReference | null,
): IntegrityCheck[] {
  const base = { scope: "history" as const, ticker, critical: true };
  const inScope = [...rows.filter((r) => years.includes(r.fiscalYear))].sort((x, y) => (x.end < y.end ? -1 : 1));
  const refs = dedupeRefs(inScope.map((r) => refFor(r.accession)).filter((r): r is CheckReference => !!r));
  const span = `FY${Math.min(...years)} to FY${Math.max(...years)}`;
  if (!inScope.length) {
    return [
      makeCheck({
        ...base,
        id: "series_continuity",
        status: "FAIL",
        title: "Annual series continuity",
        finding: `${ticker}: no annual figures for ${span} in the SEC structured data retrieved.`,
        implication: "No trend can be supported for this company.",
        action: "Locate the annual figures in the filings or drop this company from the trend.",
      }),
    ];
  }

  const fails: string[] = [];
  const cautions: string[] = [];
  const notAssessed: string[] = [];
  const extraRefs: CheckReference[] = [];

  const have = new Set(inScope.map((r) => r.fiscalYear));
  const sortedYears = [...new Set(years)].sort((a, b) => a - b);
  const first = Math.min(...have);
  const last = Math.max(...have);
  const interior = sortedYears.filter((y) => !have.has(y) && y > first && y < last);
  const edge = sortedYears.filter((y) => !have.has(y) && (y < first || y > last));
  if (edge.length) cautions.push(`${edge.map((y) => `FY${y}`).join(", ")} not available for ${ticker}; its series covers FY${first} to FY${last} only.`);

  for (let i = 1; i < inScope.length; i++) {
    const prev = inScope[i - 1];
    const next = inScope[i];
    const nextStart = next.start;
    if (!nextStart) {
      notAssessed.push(`FY${next.fiscalYear} start date not available`);
      continue;
    }
    const gap = days(prev.end, nextStart) - 1; // days not covered by either annual window
    if (gap < -CONTIGUOUS_DAYS) {
      cautions.push(`FY${prev.fiscalYear} (ended ${prev.end}) and FY${next.fiscalYear} (began ${nextStart}) overlap by ${-gap} days.`);
    } else if (gap > CONTIGUOUS_DAYS) {
      const t = shortPeriods.find((s) => s.start > prev.end && s.end < nextStart);
      if (t) {
        fails.push(
          `A ${t.days}-day transition period (${t.start} to ${t.end}, ${t.form} data) separates FY${prev.fiscalYear} (ended ${prev.end}) from FY${next.fiscalYear} (began ${nextStart}): the fiscal year-end changed.`,
        );
        extraRefs.push({ label: `${ticker} transition-period data (${t.form})`, url: t.url, accession: t.accession });
      } else {
        fails.push(`${gap} days between FY${prev.fiscalYear} (ended ${prev.end}) and FY${next.fiscalYear} (began ${nextStart}) are not covered by an annual period.`);
      }
    }
  }
  if (interior.length) fails.unshift(`FY${interior.join(", FY")} not in the annual series.`);

  const lens = inScope.filter((r) => r.start).map((r) => ({ fy: r.fiscalYear, d: inclusiveDays(r.start!, r.end) }));
  const long = lens.filter((l) => l.d >= 369);
  if (long.length && lens.some((l) => l.d <= 366)) {
    cautions.push(`${long.map((l) => `FY${l.fy} (${l.d} days${weeksNote(l.d)})`).join(", ")} longer than the other years; growth into or out of it includes an extra week.`);
  }

  const continuity = makeCheck({
    ...base,
    id: "series_continuity",
    title: "Annual series continuity",
    status: fails.length ? "FAIL" : cautions.length ? "CAUTION" : notAssessed.length ? "NOT_ASSESSED" : "PASS",
    finding: fails.length || cautions.length || notAssessed.length
      ? `${ticker}: ${[...fails, ...cautions, ...(notAssessed.length ? [`Not verified: ${notAssessed.join("; ")}.`] : [])].join(" ")}`
      : `${ticker}: FY${first} to FY${last} are consecutive full-year periods.`,
    implication: fails.length
      ? "Growth or trend figures across this break are not like-for-like annual comparisons. Single-year values remain valid."
      : cautions.length
        ? "Trend figures need a qualification."
        : notAssessed.length
          ? "Continuity could not be fully verified."
          : "The series supports year-over-year comparison.",
    references: dedupeRefs([...refs, ...extraRefs]),
    action: fails.length ? "Exclude growth across the break, or rebuild matched periods from quarterly filings." : cautions.length ? "State the series limitation next to any trend." : null,
  });

  // Tag lineage: a switch is a review signal (often a taxonomy update), never asserted to be a restatement.
  const segments: { tag: string; from: number; to: number }[] = [];
  for (const r of inScope) {
    const s = segments[segments.length - 1];
    if (s && s.tag === r.tag) s.to = r.fiscalYear;
    else segments.push({ tag: r.tag, from: r.fiscalYear, to: r.fiscalYear });
  }
  const seg = (s: { tag: string; from: number; to: number }) => `us-gaap:${s.tag} (FY${s.from}${s.to !== s.from ? ` to FY${s.to}` : ""})`;
  const lineage = makeCheck({
    ...base,
    id: "tag_lineage",
    title: "XBRL concept over time",
    status: segments.length > 1 ? "CAUTION" : "PASS",
    finding: `${ticker}: ${segments.map(seg).join(", then ")}.`,
    implication:
      segments.length > 1
        ? "The selected concept changed during the series. This is often a taxonomy or presentation update, not a restatement, but the line's scope may differ across years."
        : "Same concept throughout (tag-policy match only).",
    references: refs,
    action: segments.length > 1 ? "Compare the line item in a filing on each side of the change before reading the trend." : null,
  });
  return [continuity, lineage];
}

export function notApplicableSeries(): IntegrityCheck {
  return makeCheck({
    id: "series_continuity",
    scope: "history",
    critical: false,
    status: "NOT_APPLICABLE",
    title: "Multi-year consistency",
    finding: "Single-period comparison: multi-year series checks do not apply.",
    implication: "No trend conclusion is assessed.",
  });
}

export function unknownSeries(): IntegrityCheck {
  return makeCheck({
    id: "series_continuity",
    scope: "history",
    critical: true,
    status: "NOT_ASSESSED",
    title: "Multi-year consistency",
    finding: "The research spans several years, but the years it shows could not be identified.",
    implication: "Trend conclusions are not checked.",
    action: "Run the detailed audit for each year you rely on.",
  });
}

// ---- Assembly -----------------------------------------------------------------------------------------------------

const ORDER: IntegrityCheckId[] = ["evidence", "currency", "period_alignment", "period_duration", "definition", "formula", "provenance", "series_continuity", "tag_lineage", "revisions", "accounting_policy"];

export function assembleIntegrity(label: string, tickers: string[], values: AuditValue[], checks: IntegrityCheck[]): MetricIntegrity {
  const sorted = [...checks].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const comparison = sorted.filter((c) => c.scope === "comparison");
  const history = sorted.filter((c) => c.scope === "history");
  const readiness = reduceReadiness(comparison);

  const named = (c: IntegrityCheck) => (c.ticker ? `${c.title} (${c.ticker})` : c.title);
  const coverage = {
    assessed: sorted.filter((c) => c.status !== "NOT_ASSESSED" && c.status !== "NOT_APPLICABLE").map(named),
    notAssessed: sorted.filter((c) => c.status === "NOT_ASSESSED").map(named),
    notApplicable: sorted.filter((c) => c.status === "NOT_APPLICABLE").map(named),
  };

  const pair = tickers.join(" and ");
  const fails = comparison.filter((c) => c.status === "FAIL");
  const cautions = comparison.filter((c) => c.status === "CAUTION" || (c.status === "NOT_ASSESSED" && c.critical));
  const infos = comparison.filter((c) => c.status === "INFO");
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

  let allowableConclusion: string | null = null;
  let withheldConclusionReason: string | null = null;
  if (readiness === "READY") {
    allowableConclusion = `${label} for ${pair} can be compared for the audited fiscal year${infos.length ? `, disclosing: ${infos.map((c) => lower(c.title)).join(", ")}` : ""}. Accounting-policy equivalence is not assessed.`;
  } else if (readiness === "REVIEW") {
    allowableConclusion = `Provisional only: any ${label.toLowerCase()} comparison of ${pair} must be qualified for ${cautions.map((c) => lower(c.title)).join(", ")}.`;
  } else {
    withheldConclusionReason = `${fails[0].title}: ${fails[0].finding} Sourced values are shown, but which company is higher or stronger on ${label.toLowerCase()} is not supported.`;
  }

  const actionable = [...fails, ...cautions].find((c) => c.action);
  const analystAction =
    actionable?.action ??
    (readiness === "READY" ? "No blocking issue found. Read the coverage limits before relying on the comparison." : "Review the flagged checks before relying on the comparison.");

  let trend: MetricIntegrity["trend"] = null;
  if (history.length && history.some((c) => c.status !== "NOT_APPLICABLE")) {
    const h = reduceReadiness(history);
    const worstHistory = history.find((c) => c.status === "FAIL") ?? history.find((c) => c.status === "CAUTION" || c.status === "NOT_ASSESSED");
    trend = {
      readiness: worstReadiness(readiness, h),
      summary: worstHistory ? worstHistory.finding : "Each company's annual series is continuous with a consistent concept.",
    };
  }

  return {
    version: 2,
    readiness,
    checks: sorted,
    coverage,
    sourceBasis: Object.fromEntries(values.map((v) => [v.ticker, sourceBasisOf(v)])),
    analystAction,
    allowableConclusion,
    withheldConclusionReason,
    trend,
  };
}
