// Deterministic comparability engine. Pure: takes already-retrieved SEC facts and returns the audit. No network,
// no model. Every status, figure and adjustment is decided here; the model may only add validated notes afterwards.
import { evaluateExpression } from "../agent/tools/calculate";
import { formatMoney, TAGS } from "../agent/tools/getFinancials";
import {
  assembleIntegrity,
  coverageChecks,
  currencyCheck,
  definitionCheck,
  evidenceCheck,
  findConflict,
  makeCheck,
  mergeChecks,
  notApplicableSeries,
  periodAlignmentCheck,
  periodDurationCheck,
  provenanceCheck,
  revisionCheck,
  seriesChecks,
  unknownSeries,
  type PriorReport,
  type ShortPeriod,
} from "./integrity";
import { READINESS_LABEL } from "./report";
import type {
  AuditAdjustment,
  AuditCheck,
  AuditCompany,
  AuditEvidence,
  AuditMetricId,
  AuditValue,
  ComparabilityAudit,
  ComparabilityStatus,
  EvidenceQuality,
  IntegrityCheck,
  IntegrityCheckId,
  MetricAudit,
  MetricIntegrity,
  Readiness,
} from "./types";

export type ReportedMetric = "revenue" | "operating_income" | "net_income";
export const REPORTED_METRICS: ReportedMetric[] = ["revenue", "operating_income", "net_income"];

// One annual fact as get_financials returns it. `periodStart` is added by the audit's own retrieval (retrieve.ts)
// from the same XBRL fact; get_financials itself does not return it.
export type FactRow = {
  fiscalYear: number;
  periodEnd: string;
  value: number;
  form: string;
  filed: string;
  tag: string;
  citationKey: string;
  periodStart?: string;
  priorReports?: PriorReport[]; // earlier filings of the same concept and period; absent when not retrieved
};
export type FilingRef = { url: string; form: string; filed: string };

export type CompanyData = {
  company: AuditCompany;
  metrics: Record<ReportedMetric, FactRow[]>;
  nonUsdUnits: Partial<Record<ReportedMetric, string[]>>; // set when the metric exists only in a non-USD unit
  filings: Record<string, FilingRef>; // accession -> filing
  shortPeriods?: ShortPeriod[]; // sub-annual periods between annual windows (fiscal year-end transitions)
  error?: string; // retrieval failed for the whole company
};

// Years of a multi-year research answer, so each company's own series is checked; "unknown" when the research
// spans several years it does not name. Absent for a single-period audit.
export type SeriesScope = number[] | "unknown";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ALIGNED_DAYS = 31; // fiscal year-ends within a month: no realignment checklist item
export const PARTIAL_DAYS = 183; // label-matched years further apart than this are realigned to the nearest year

const LABELS: Record<AuditMetricId, string> = {
  revenue: "Revenue",
  operating_income: "Operating income",
  operating_margin: "Operating margin",
  net_income: "Net income",
};

const DEFINITIONS: Record<AuditMetricId, string> = {
  revenue: "Total annual revenue as reported in the 10-K income statement (US GAAP, XBRL revenue concepts).",
  operating_income:
    "Operating income (loss) as reported under the us-gaap OperatingIncomeLoss concept. Not reconstructed when a company does not report the line.",
  operating_margin: "Operating income divided by revenue for the same fiscal period, times 100. Computed by the calculate engine.",
  net_income: "Net income (loss) attributable to the company, as reported in the 10-K (us-gaap NetIncomeLoss, ProfitLoss as fallback).",
};

const SEVERITY: Record<ComparabilityStatus, number> = {
  COMPARABLE: 0,
  ADJUSTED: 1,
  PARTIALLY_COMPARABLE: 2,
  NOT_COMPARABLE: 3,
  INSUFFICIENT_EVIDENCE: 4,
};
export const worst = (...s: ComparabilityStatus[]) => s.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "COMPARABLE");

export const dayGap = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS);

// ---- Period selection ---------------------------------------------------------------------------------------------

export type PeriodChoice = {
  a: { fiscalYear: number; periodEnd: string } | null;
  b: { fiscalYear: number; periodEnd: string } | null;
  gapDays: number | null;
  realigned: { labelMatchEnd: string; labelMatchGap: number } | null; // B moved off its label-matched year
};

function periodsOf(d: CompanyData) {
  const seen = new Map<string, number>();
  for (const m of REPORTED_METRICS) for (const r of d.metrics[m]) seen.set(r.periodEnd, r.fiscalYear);
  return [...seen.entries()].map(([periodEnd, fiscalYear]) => ({ periodEnd, fiscalYear })).sort((x, y) => (x.periodEnd < y.periodEnd ? 1 : -1));
}

// Company A anchors the period. B takes the same fiscal-year label, unless a different B year ends materially
// closer to A's year-end (labels can sit almost a year apart: Nike's FY ends in May, retailers' in early February).
export function choosePeriods(a: CompanyData, b: CompanyData, period: number | "latest"): PeriodChoice {
  const pa = periodsOf(a);
  const pb = periodsOf(b);
  const anchor = period === "latest" ? pa[0] : pa.find((p) => p.fiscalYear === period);
  if (!anchor) {
    const bOnly = period === "latest" ? pb[0] : pb.find((p) => p.fiscalYear === period);
    return { a: null, b: bOnly ?? null, gapDays: null, realigned: null };
  }
  const label = period === "latest" ? pb[0] : pb.find((p) => p.fiscalYear === anchor.fiscalYear);
  const nearest = [...pb].sort((x, y) => dayGap(x.periodEnd, anchor.periodEnd) - dayGap(y.periodEnd, anchor.periodEnd))[0];
  if (!nearest) return { a: anchor, b: null, gapDays: null, realigned: null };
  if (label && (dayGap(label.periodEnd, anchor.periodEnd) <= PARTIAL_DAYS || label.periodEnd === nearest.periodEnd)) {
    return { a: anchor, b: label, gapDays: dayGap(label.periodEnd, anchor.periodEnd), realigned: null };
  }
  return {
    a: anchor,
    b: nearest,
    gapDays: dayGap(nearest.periodEnd, anchor.periodEnd),
    realigned: label ? { labelMatchEnd: label.periodEnd, labelMatchGap: dayGap(label.periodEnd, anchor.periodEnd) } : null,
  };
}

// ---- Adjustment verification (invariants 2, 4, 11) ----------------------------------------------------------------

// A derivation is accepted only if every number in its formula is one of the evidenced inputs and re-evaluating the
// formula reproduces the stated output.
export function verifyDerivation(adj: AuditAdjustment, allowedInputs: number[]): { ok: true } | { ok: false; reason: string } {
  const numbers = (adj.formula.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
  const allowed = new Set([...allowedInputs.map(Math.abs), 100]); // 100: percent scaling; signs are matched separately
  const foreign = numbers.filter((n) => !allowed.has(n));
  if (foreign.length) return { ok: false, reason: `formula uses numbers not in the evidence: ${foreign.join(", ")}` };
  const r = evaluateExpression(adj.formula);
  if ("error" in r) return { ok: false, reason: r.error };
  if (adj.outputValue === null || Math.abs(r.result - adj.outputValue) > 1e-4 * Math.max(1, Math.abs(r.result))) {
    return { ok: false, reason: `formula evaluates to ${r.result}, not the stated ${adj.outputValue}` };
  }
  return { ok: true };
}

// ---- Metric audits ------------------------------------------------------------------------------------------------

function evidenceFor(d: CompanyData, row: FactRow): AuditEvidence[] {
  const f = d.filings[row.citationKey];
  if (!f) return []; // no registered filing: the value stays, but it is unverified and the validator will refuse it
  return [
    {
      sourceId: row.citationKey,
      ticker: d.company.ticker,
      documentTitle: `${d.company.name} ${f.form} (filed ${f.filed})`,
      documentUrl: f.url,
      form: f.form,
      filingDate: f.filed,
      accessionNumber: row.citationKey,
      xbrlConcept: row.tag,
    },
  ];
}

function emptyValue(ticker: string, unit: string, basis: AuditValue["reportingBasis"]): AuditValue {
  return {
    ticker,
    reportedValue: null,
    normalizedValue: null,
    display: null,
    currency: null,
    unit,
    fiscalYear: null,
    periodEnd: null,
    periodStart: null,
    periodType: "annual",
    reportingBasis: basis,
    sourceBasis: "UNAVAILABLE",
    evidence: [],
  };
}

function quality(values: AuditValue[]): EvidenceQuality {
  const n = values.filter((v) => v.evidence.length > 0).length;
  return n === values.length ? "VERIFIED" : n > 0 ? "PARTIAL" : "UNVERIFIED";
}

// The legacy status follows the V2 period-alignment check: an ordinary fiscal-calendar difference (INFO) stays
// comparable and is disclosed; only a materially partial overlap or a different period downgrades it.
function periodStatus(p: PeriodChoice, alignment: IntegrityCheck): { status: ComparabilityStatus; check: AuditCheck; caveat?: string } {
  if (!p.a || !p.b || p.gapDays === null) {
    return { status: "INSUFFICIENT_EVIDENCE", check: { id: "period", passed: false, detail: "No matching annual period for both companies." } };
  }
  const ends = `${p.a.periodEnd} vs ${p.b.periodEnd}`;
  const detail = `Fiscal year-ends ${ends} are ${p.gapDays} days apart. ${alignment.finding.split("; ").slice(1).join("; ")}`.trim();
  if (alignment.status === "PASS" || alignment.status === "INFO") {
    return {
      status: p.realigned ? "ADJUSTED" : "COMPARABLE",
      check: { id: "period", passed: true, detail: alignment.status === "PASS" ? `Fiscal year-ends ${ends} are ${p.gapDays} days apart.` : detail },
      caveat:
        alignment.status === "INFO"
          ? `Fiscal years end ${p.gapDays} days apart (${ends}). Both are annual periods with most months in common: an ordinary fiscal-calendar difference, usable for annual benchmarking, but the windows are not identical.`
          : undefined,
    };
  }
  if (alignment.status === "CAUTION") {
    return {
      status: "PARTIALLY_COMPARABLE",
      check: { id: "period", passed: false, detail },
      caveat: `Fiscal years end ${p.gapDays} days apart (${ends}), so the periods overlap only partly. Seasonality and macro conditions may differ between the two windows.`,
    };
  }
  return {
    status: "NOT_COMPARABLE",
    check: { id: "period", passed: false, detail },
    caveat: `The closest available fiscal years end ${p.gapDays} days apart (${ends}); they are not the same economic period.`,
  };
}

function realignmentAdjustment(p: PeriodChoice, b: CompanyData, evidence: AuditEvidence[]): AuditAdjustment | null {
  if (!p.realigned || !p.a || !p.b || !evidence.length) return null;
  return {
    kind: "period_realignment",
    ticker: b.company.ticker,
    description: `${b.company.ticker}'s FY${p.a.fiscalYear} label ends ${p.realigned.labelMatchEnd}, ${p.realigned.labelMatchGap} days from ${p.a.periodEnd}. Used ${b.company.ticker} FY${p.b.fiscalYear} (ended ${p.b.periodEnd}, ${p.gapDays} days away) instead, the closest annual period.`,
    formula: `select period end minimizing |end - ${p.a.periodEnd}| -> ${p.b.periodEnd}`,
    inputSourceIds: evidence.map((e) => e.sourceId),
    outputValue: null,
    outputDisplay: null,
  };
}

const notChecked = (id: IntegrityCheckId, title: string, ids: string[]) =>
  makeCheck({ id, critical: true, status: "NOT_ASSESSED", title, finding: "Not checked: a value is missing.", implication: "Checked only once both values exist.", evidenceIds: ids });

function historyChecks(metric: ReportedMetric, sides: CompanyData[], series: SeriesScope | undefined): IntegrityCheck[] {
  if (!series) return [notApplicableSeries()];
  if (series === "unknown") return [unknownSeries()];
  return sides.flatMap((d) =>
    seriesChecks(
      d.company.ticker,
      d.metrics[metric].map((r) => ({ fiscalYear: r.fiscalYear, start: r.periodStart ?? null, end: r.periodEnd, tag: r.tag, accession: r.citationKey })),
      series,
      d.shortPeriods ?? [],
      (accn) => {
        const f = d.filings[accn];
        return f ? { label: `${d.company.ticker} ${f.form} (filed ${f.filed})`, url: f.url, accession: accn } : null;
      },
    ),
  );
}

function auditReported(metric: ReportedMetric, a: CompanyData, b: CompanyData, p: PeriodChoice, series?: SeriesScope): MetricAudit {
  const checks: AuditCheck[] = [];
  const caveats: string[] = [];
  const adjustments: AuditAdjustment[] = [];
  let status: ComparabilityStatus = "COMPARABLE";
  const sides = [
    { d: a, end: p.a?.periodEnd },
    { d: b, end: p.b?.periodEnd },
  ];

  const rows = sides.map(({ d, end }) => (end ? d.metrics[metric].find((r) => r.periodEnd === end) ?? null : null));
  const values = sides.map(({ d }, i) => {
    const row = rows[i];
    if (!row) return emptyValue(d.company.ticker, "USD", "US GAAP (as reported, XBRL)");
    return {
      ...emptyValue(d.company.ticker, "USD", "US GAAP (as reported, XBRL)"),
      reportedValue: row.value,
      display: formatMoney(row.value),
      currency: "USD",
      fiscalYear: row.fiscalYear,
      periodEnd: row.periodEnd,
      periodStart: row.periodStart ?? null,
      sourceBasis: "DIRECT_REPORTED",
      evidence: evidenceFor(d, row),
    } satisfies AuditValue;
  });
  const ids = values.flatMap((v) => v.evidence.map((e) => e.sourceId));

  // Currency: only USD facts are retrieved. A metric that exists only in another currency cannot be converted
  // without a documented rate, so it is not comparable rather than silently missing.
  const nonUsd = sides
    .map(({ d }, i) => (!rows[i] && d.nonUsdUnits[metric]?.length ? { ticker: d.company.ticker, units: d.nonUsdUnits[metric]! } : null))
    .filter((x): x is { ticker: string; units: string[] } => !!x);
  const currencyIssues = nonUsd.map((n) => `${n.ticker} reports ${LABELS[metric].toLowerCase()} in ${n.units.join(", ")}`);
  if (currencyIssues.length) {
    status = "NOT_COMPARABLE";
    checks.push({ id: "currency", passed: false, detail: `${currencyIssues.join("; ")}, not USD.` });
    caveats.push(`${currencyIssues.join("; ")}. No documented FX rate is available, so no conversion was performed.`);
  } else {
    checks.push({ id: "currency", passed: rows.every(Boolean), detail: rows.every(Boolean) ? "Both values are reported in USD." : "Currency not established for a missing value." });
  }

  // Evidence. Missing SEC Company Facts data is a coverage gap of the data source, not proof the filing omits it.
  const missing = sides.filter((_, i) => !rows[i] && !nonUsd.some((n) => n.ticker === sides[i].d.company.ticker));
  const missingReasons: { ticker: string; reason: string }[] = [];
  if (missing.length) {
    status = worst(status, "INSUFFICIENT_EVIDENCE");
    for (const { d } of missing) {
      const why = d.error
        ? `${d.company.ticker}: data retrieval failed (${d.error}).`
        : metric === "operating_income" && d.metrics[metric].length === 0
          ? `${d.company.ticker}: no us-gaap OperatingIncomeLoss fact in SEC Company Facts for any year retrieved. The 10-K may present operating results under another line; this is a structured-data gap, and the figure is not estimated.`
          : `${d.company.ticker}: no annual ${LABELS[metric].toLowerCase()} fact for the selected period in SEC Company Facts (us-gaap ${TAGS[metric].join(", ")}).`;
      caveats.push(why);
      missingReasons.push({ ticker: d.company.ticker, reason: why });
    }
  }
  const unsourced = values.filter((v) => v.reportedValue !== null && v.evidence.length === 0);
  checks.push({
    id: "evidence",
    passed: !missing.length && !unsourced.length,
    detail: missing.length
      ? `Missing for ${missing.map((m) => m.d.company.ticker).join(", ")}.`
      : unsourced.length
        ? `No filing link for ${unsourced.map((v) => v.ticker).join(", ")}.`
        : "Each value maps to a 10-K accession number.",
  });
  if (unsourced.length) status = worst(status, "INSUFFICIENT_EVIDENCE");

  const integrityChecks: IntegrityCheck[] = [
    evidenceCheck(values, missingReasons, nonUsd.map((n) => n.ticker), ids),
    currencyCheck(values, nonUsd, ids),
  ];

  if (rows[0] && rows[1]) {
    const sideOf = (i: number) => ({ ticker: sides[i].d.company.ticker, start: rows[i]!.periodStart ?? null, end: rows[i]!.periodEnd });
    const alignment = periodAlignmentCheck(sideOf(0), sideOf(1), ids);
    const per = periodStatus(p, alignment);
    status = worst(status, per.status);
    checks.push(per.check);
    if (per.caveat) caveats.push(per.caveat);
    const adj = realignmentAdjustment(p, b, values[1].evidence);
    if (adj) adjustments.push(adj);

    // Definition: a known conflict is flagged; a different concept is a review signal, never assumed equivalent.
    const [ta, tb] = [rows[0].tag, rows[1].tag];
    const conflict = findConflict(metric, ta, tb);
    if (conflict) {
      status = worst(status, "PARTIALLY_COMPARABLE");
      caveats.push(conflict.note);
      checks.push({ id: "definition", passed: false, detail: `${a.company.ticker}: ${ta}; ${b.company.ticker}: ${tb}.` });
    } else if (ta !== tb) {
      caveats.push(`Different XBRL concepts (${a.company.ticker}: ${ta}; ${b.company.ticker}: ${tb}). Both are US GAAP ${LABELS[metric].toLowerCase()} lines, but their equivalence is not established; confirm scope in the filings.`);
      checks.push({ id: "definition", passed: false, detail: `Different concepts (${ta} vs ${tb}); equivalence not established.` });
    } else {
      checks.push({ id: "definition", passed: true, detail: `Both report ${ta}.` });
    }

    integrityChecks.push(
      alignment,
      periodDurationCheck([sideOf(0), sideOf(1)], ids),
      definitionCheck(metric, { ticker: a.company.ticker, tag: ta }, { ticker: b.company.ticker, tag: tb }, ids),
    );
  } else {
    integrityChecks.push(
      notChecked("period_alignment", "Fiscal period alignment", ids),
      notChecked("period_duration", "Period length", ids),
      notChecked("definition", "Metric definition (XBRL concept)", ids),
    );
  }
  const revisions = revisionCheck(
    LABELS[metric],
    sides.map(({ d }, i) => ({ ticker: d.company.ticker, row: rows[i] })),
    ids,
  );
  integrityChecks.push(provenanceCheck(values, ids), ...historyChecks(metric, [a, b], series), ...coverageChecks(revisions));

  const integrity = assembleIntegrity(LABELS[metric], [a.company.ticker, b.company.ticker], values, integrityChecks);
  return finish(metric, values, adjustments, checks, status, caveats, integrity);
}

function finish(
  metricId: AuditMetricId,
  values: AuditValue[],
  adjustments: AuditAdjustment[],
  checks: AuditCheck[],
  status: ComparabilityStatus,
  caveats: string[],
  integrity: MetricIntegrity,
): MetricAudit {
  const label = LABELS[metricId];
  const explanation =
    status === "COMPARABLE"
      ? `${label} is reported on the same basis and period for both companies.`
      : status === "ADJUSTED"
        ? `${label} is comparable after the documented adjustment.`
        : status === "PARTIALLY_COMPARABLE"
          ? `${label} can be compared with the limitations listed.`
          : status === "NOT_COMPARABLE"
            ? `${label} should not be compared directly.`
            : `The retrieved evidence does not support a conclusion on ${label.toLowerCase()}.`;
  return {
    metricId,
    label,
    definition: DEFINITIONS[metricId],
    values,
    adjustments,
    checks,
    status,
    evidenceQuality: quality(values),
    caveats,
    explanation,
    requiresHumanReview: status !== "COMPARABLE",
    aiNotes: [],
    integrity,
  };
}

// Operating margin = operating income / revenue * 100, through the calculate engine and re-verified.
function auditMargin(revenue: MetricAudit, opInc: MetricAudit): MetricAudit {
  const checks: AuditCheck[] = [];
  const caveats: string[] = [];
  const adjustments: AuditAdjustment[] = [];
  let status = worst(revenue.status, opInc.status);
  const formulaNotes: string[] = [];
  let formulaFailed = false;

  const values = revenue.values.map((rv, i) => {
    const ov = opInc.values[i];
    const base = emptyValue(rv.ticker, "percent", "Derived from US GAAP inputs");
    const evidence = [...rv.evidence, ...ov.evidence.filter((e) => !rv.evidence.some((x) => x.sourceId === e.sourceId))];
    if (rv.reportedValue === null || ov.reportedValue === null) return { ...base, evidence: [] };
    if (rv.periodEnd !== ov.periodEnd) {
      // Defensive: both inputs come from the same period selection, so this should not happen.
      formulaFailed = true;
      formulaNotes.push(`${rv.ticker}: inputs come from different periods (${rv.periodEnd} vs ${ov.periodEnd}).`);
      checks.push({ id: "calculation", passed: false, detail: `${rv.ticker}: mixed fiscal windows.` });
      return { ...base, evidence };
    }
    if (rv.reportedValue === 0) {
      formulaFailed = true;
      formulaNotes.push(`${rv.ticker}: revenue is zero, so the ratio is undefined.`);
      caveats.push(`${rv.ticker}: revenue is zero, so operating margin is undefined.`);
      checks.push({ id: "calculation", passed: false, detail: `${rv.ticker}: zero denominator.` });
      return { ...base, evidence };
    }
    const formula = `${ov.reportedValue} / ${rv.reportedValue} * 100`;
    const r = evaluateExpression(formula);
    if ("error" in r) {
      formulaFailed = true;
      formulaNotes.push(`${rv.ticker}: ${r.error}.`);
      checks.push({ id: "calculation", passed: false, detail: `${rv.ticker}: ${r.error}` });
      return { ...base, evidence };
    }
    const adj: AuditAdjustment = {
      kind: "derivation",
      ticker: rv.ticker,
      description: `${rv.ticker} operating margin = operating income / revenue x 100`,
      formula,
      inputSourceIds: evidence.map((e) => e.sourceId),
      outputValue: r.result,
      outputDisplay: `${r.result.toFixed(1)}%`,
    };
    const v = verifyDerivation(adj, [ov.reportedValue, rv.reportedValue]);
    if (!v.ok) {
      formulaFailed = true;
      formulaNotes.push(`${rv.ticker}: rejected (${v.reason}).`);
      checks.push({ id: "calculation", passed: false, detail: `${rv.ticker}: rejected (${v.reason}).` });
      return { ...base, evidence };
    }
    adjustments.push(adj);
    formulaNotes.push(`${rv.ticker}: ${formula} = ${adj.outputDisplay}.`);
    checks.push({ id: "calculation", passed: true, detail: `${rv.ticker}: ${formula} = ${r.result} (re-verified).` });
    return {
      ...base,
      normalizedValue: r.result,
      display: adj.outputDisplay,
      unit: "percent",
      currency: "USD",
      fiscalYear: rv.fiscalYear,
      periodEnd: rv.periodEnd,
      periodStart: rv.periodStart ?? null,
      sourceBasis: "DERIVED",
      evidence,
    } satisfies AuditValue;
  });

  if (values.some((v) => v.normalizedValue === null)) {
    status = worst(status, "INSUFFICIENT_EVIDENCE");
    if (!caveats.length) caveats.push("Operating margin needs both revenue and operating income for the same period; at least one is missing.");
  } else {
    caveats.push(...new Set([...revenue.caveats, ...opInc.caveats].filter((c) => /days apart|assessed|concept/i.test(c))));
  }
  // The realignment, if any, applies to the margin inputs too.
  adjustments.push(...revenue.adjustments.filter((x) => x.kind === "period_realignment" && values[1].evidence.some((e) => x.inputSourceIds.includes(e.sourceId))));
  if (!checks.some((c) => c.id === "calculation")) {
    checks.push({ id: "calculation", passed: false, detail: "Not computed: inputs missing." });
  }

  // Integrity: the formula check, plus every input check inherited (worst of revenue and operating income).
  const ids = new Set(values.flatMap((v) => v.evidence.map((e) => e.sourceId)));
  const computed = values.every((v) => v.normalizedValue !== null);
  const formulaCheck = makeCheck({
    id: "formula",
    critical: true,
    title: "Formula integrity",
    status: formulaFailed ? "FAIL" : computed ? "PASS" : "NOT_ASSESSED",
    finding: computed
      ? `${formulaNotes.join(" ")} Same canonical formula for both: OperatingIncomeLoss / revenue x 100, inputs from the same fiscal period, USD over USD.`
      : `${formulaNotes.join(" ")}${formulaFailed ? "" : `${formulaNotes.length ? " " : ""}Not computed for ${values.filter((v) => v.normalizedValue === null).map((v) => v.ticker).join(", ")}: an input is missing.`}`,
    implication: formulaFailed
      ? "The ratio cannot be supported for at least one company; no substitute value is produced."
      : computed
        ? "Re-evaluated by the calculate engine from the sourced inputs."
        : "Depends on the missing input.",
    evidenceIds: [...ids],
    action: formulaFailed ? "Check the inputs in the filing; the ratio is withheld until they are valid." : null,
  });
  const inputs = [revenue.integrity!, opInc.integrity!];
  const key = (c: IntegrityCheck) => `${c.id}|${c.ticker ?? ""}`;
  const inheritedKeys = [...new Set(inputs.flatMap((x) => x.checks.filter((c) => !["provenance", "accounting_policy"].includes(c.id)).map(key)))];
  const inherited = inheritedKeys.map((k) => {
    const found = inputs.map((x, i) => ({ c: x.checks.find((c) => key(c) === k), p: i === 0 ? "Revenue" : "Operating income" })).filter((x) => x.c);
    const merged = mergeChecks(found.map((x) => x.c!), found.map((x) => x.p));
    return { ...merged, evidenceIds: merged.evidenceIds.filter((id) => ids.has(id)) };
  });
  const integrity = assembleIntegrity(LABELS.operating_margin, values.map((v) => v.ticker), values, [
    formulaCheck,
    ...inherited.filter((c) => c.id !== "revisions"),
    provenanceCheck(values, [...ids]),
    ...coverageChecks(inherited.find((c) => c.id === "revisions") ?? null),
  ]);
  return finish("operating_margin", values, adjustments, checks, status, caveats, integrity);
}

// ---- Whole audit --------------------------------------------------------------------------------------------------

const LIMITATIONS = [
  "This is an evidence-backed comparison integrity review of SEC XBRL data, not a statutory financial audit.",
  "Only annual 10-K US GAAP facts in USD are used. Non-GAAP measures, segment data, company-specific extension concepts and IFRS filers (20-F) are out of scope.",
  "Periods are aligned by choosing the nearest fiscal year-end; quarterly recalendarization (trailing twelve months) is not performed.",
  "When a figure was restated, the most recently filed value is used; earlier versions are not compared.",
  "Missing figures mean missing from SEC Company Facts (structured XBRL data), not necessarily absent from the filing.",
];


export function buildAudit(
  a: CompanyData,
  b: CompanyData,
  period: number | "latest",
  opts: { auditId: string; now: Date; series?: SeriesScope },
): ComparabilityAudit {
  const p = choosePeriods(a, b, period);
  const revenue = auditReported("revenue", a, b, p, opts.series);
  const opInc = auditReported("operating_income", a, b, p, opts.series);
  const margin = auditMargin(revenue, opInc);
  const net = auditReported("net_income", a, b, p, opts.series);
  const metrics = [revenue, opInc, margin, net];

  const insufficient = metrics.filter((m) => m.status === "INSUFFICIENT_EVIDENCE");
  const others = metrics.filter((m) => m.status !== "INSUFFICIENT_EVIDENCE");
  const overallStatus: ComparabilityStatus = !others.length
    ? "INSUFFICIENT_EVIDENCE"
    : worst(...others.map((m) => m.status), insufficient.length ? "PARTIALLY_COMPARABLE" : "COMPARABLE");

  const [ta, tb] = [a.company.ticker, b.company.ticker];
  const periodText =
    p.a && p.b ? `${ta} FY${p.a.fiscalYear} (ended ${p.a.periodEnd}) vs ${tb} FY${p.b.fiscalYear} (ended ${p.b.periodEnd})` : `${ta} vs ${tb}`;
  const counts = (s: ComparabilityStatus) => metrics.filter((m) => m.status === s).length;
  const parts = [
    `${periodText}: ${counts("COMPARABLE")} of ${metrics.length} metrics comparable as reported`,
    counts("ADJUSTED") ? `${counts("ADJUSTED")} comparable after a documented adjustment` : "",
    counts("PARTIALLY_COMPARABLE") ? `${counts("PARTIALLY_COMPARABLE")} partially comparable` : "",
    counts("NOT_COMPARABLE") ? `${counts("NOT_COMPARABLE")} not comparable` : "",
    insufficient.length ? `${insufficient.length} with insufficient evidence (${insufficient.map((m) => m.label.toLowerCase()).join(", ")})` : "",
  ].filter(Boolean);
  const overallAssessment = `${parts.join(", ")}.` + (overallStatus === "COMPARABLE" ? "" : " Review the flagged metrics before relying on the comparison.");

  const limitations = [...LIMITATIONS];
  if (a.error) limitations.unshift(`${ta}: ${a.error}`);
  if (b.error) limitations.unshift(`${tb}: ${b.error}`);

  const byReadiness = (r: Readiness) => metrics.filter((m) => m.integrity?.readiness === r);
  // Display text only (the readiness values themselves are in readinessByMetric), worded with the shared labels.
  const verdict =
    (["READY", "REVIEW", "BLOCKED"] as Readiness[])
      .filter((r) => byReadiness(r).length)
      .map((r) => `${READINESS_LABEL[r]}: ${byReadiness(r).map((m) => m.label.toLowerCase()).join(", ")}.`)
      .join(" ") + " Based only on the checks listed; accounting-policy equivalence is not assessed.";

  const actions = metrics
    .filter((m) => m.integrity && m.integrity.readiness !== "READY")
    .map((m) => `${m.label}: ${m.integrity!.analystAction}`);
  const reviewChecklist = [
    "Open each linked 10-K and confirm the figures match the income statement.",
    ...(p.gapDays && p.gapDays > ALIGNED_DAYS ? [`Decide whether a ${p.gapDays}-day fiscal year-end gap is acceptable for this comparison.`] : []),
    ...(p.realigned ? [`Confirm the period realignment for ${tb} (nearest fiscal year rather than the matching label).`] : []),
    ...metrics.filter((m) => m.checks.some((c) => c.id === "definition" && !c.passed)).map((m) => `Reconcile the ${m.label.toLowerCase()} definitions between ${ta} and ${tb}.`),
    ...insufficient.map((m) => `Locate evidence for ${m.label.toLowerCase()} or exclude it from the comparison.`),
    ...[...new Set(actions)],
    "Check the filings for one-time items (restructuring, impairments, divestitures) that distort operating results.",
  ];

  return {
    auditId: opts.auditId,
    generatedAt: opts.now.toISOString(),
    companies: [a.company, b.company],
    requestedPeriod: period,
    metrics,
    overallStatus,
    overallAssessment,
    aiInterpretation: null,
    limitations,
    reviewChecklist,
    partial: insufficient.length > 0,
    requiresHumanReview: metrics.some((m) => m.requiresHumanReview),
    integrity: {
      version: 2,
      readinessByMetric: Object.fromEntries(metrics.map((m) => [m.metricId, m.integrity!.readiness])),
      verdict,
      coverage: [
        "Assessed per metric: source evidence, currency, fiscal period alignment and length, XBRL concept, formula (derived metrics), source basis.",
        "Revision signals: values of the audited year compared with earlier filings of the same concept and period; the reason for a change is not established.",
        "Not assessed: accounting-policy and footnote equivalence, non-GAAP measures, segment data.",
      ],
    },
  };
}
