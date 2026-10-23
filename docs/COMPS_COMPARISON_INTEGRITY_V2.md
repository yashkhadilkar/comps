# Comps — Comparison Integrity V2

**Status:** Implementation specification for Claude Code review and execution  
**Type:** Additive enhancement to the existing Comparability Audit  
**Priority:** P0 decision usefulness and correctness; P1 historical revision lineage  
**Source basis:** `docs/COMPS_AUDIT_SPRINT.md`, `deep-research-report-comps-gaps.md`, and the current feature behavior described by the team. The live repository must be inspected before implementation.

---

## 1. Executive decision

### Reposition the existing feature

Rename its user-facing purpose from a broad *Comparability Audit* toward **Financial Comparison Integrity Review**. Preserve existing routes, API endpoints, stored fields, enum contracts and legacy headings where changing them would break compatibility. A UI label change is optional; the functional behavior change is essential.

**Old behavior:** Gather financial facts, compare periods/currency/XBRL tags, and display a five-category comparability status and caveats.

**V2 behavior:** Check whether the available, explicitly assessed financial evidence supports an analyst's *specific comparative conclusion*. Show what passed, what needs review, what blocks a conclusion, which numbers were derived, and what to do next.

**Product promise:** *Before you trust a comp, check the integrity of its evidence and calculation basis.*

**Not the promise:** A statutory financial-statement audit, full accounting-policy equivalence, validated economic comparability of every tag, IFRS-to-US-GAAP reconciliation, or a guarantee that passing checks means the conclusion is correct.

### Hard principle

**No new capability may break existing Comps research.** The V2 layer must be additive, deterministic for statuses and calculations, evidence-linked, backward-compatible, testable and failure-isolated.

---

## 2. Scope and priorities

| Priority | Feature | Outcome | Scope |
|---|---|---|---|
| P0 | Metric definition integrity | Identify directly incompatible metric definitions; distinguish tag differences from confirmed semantic conflicts | Available SEC XBRL facts/metadata and an explicit, bounded equivalence policy |
| P0 | Historical consistency | Show non-equivalent annual periods, missing coverage, fiscal-year transitions and selected-tag changes | Available period metadata and fact lineage |
| P0 | Comparison decision gate | READY / REVIEW / BLOCKED for each audited metric and relevant conclusion | Deterministic interpretation of assessed checks |
| P0 | Evidence provenance | Reported / DERIVED / UNAVAILABLE, with exact sourced inputs and validated formulas | Existing SEC evidence and deterministic calculator |
| P0 | Honest coverage + severity | Distinguish harmless information from meaningful review issues and blockers; make not-assessed visible | Existing plus new check schema |
| P1 | Revision and restatement signals | Detect differing values for a matched historical period across filing versions | Requires preserving/accessing multiple candidates; do not call a revision a confirmed restatement without evidence |

P0 is the deliverable. P1 should be attempted only after the existing feature and regression suite are stable.

### Explicit exclusions

- No universal GAAP/IFRS normalization or financial-statement audit.
- No automatic currency conversion unless a documented FX rate, effective date and permitted use are available; preserve the existing currency check.
- No assertion that two companies' accounting policies or economic activities are identical solely from matching XBRL tags.
- No sweeping retrieval, database, calculator, chat agent, citations or UI architecture rewrites.
- No speculative estimation of missing reported metrics.
- No new fee, subscription, usage/billing, authentication or deployment semantics.
- No new metrics or multi-company feature merely to increase apparent breadth.

---

## 3. First inspect actual implementation

Before edits, Claude Code must read repository guidance (`CLAUDE.md`, relevant audit docs, source code and tests) and produce a concise map of:

1. Existing audit API entry points, UI components and five-category status logic.
2. Current SEC facts selection and provenance metadata (`start`, `end`, `fy`, `fp`, `form`, `filed`, `accn`, `unit`, `tag`, if available).
3. Current derivation/calculator and evidence/citation data model.
4. How normal comparison queries invoke audit generation, and how the result appears in streamed answers and `/audit`.
5. Any persisted audit schemas/exports and existing consumers that could break from contract changes.
6. Existing test commands, build commands and deployment configuration.

Do not assume any file path, service or metadata exists merely because this spec names it conceptually. Adapt to verified code. If a check cannot be implemented from trusted current data, display **NOT_ASSESSED**, not PASS.

---

## 4. Critical design distinction: three layers of result

Avoid conflating these:

**A. Check outcome** — `PASS | INFO | CAUTION | FAIL | NOT_ASSESSED` for one specific rule; optionally `NOT_APPLICABLE` where justified. A check can PASS only if the required evidence is actually present.

**B. Metric comparability status** — preserve the existing outward contract: `COMPARABLE | ADJUSTED | PARTIALLY_COMPARABLE | NOT_COMPARABLE | INSUFFICIENT_EVIDENCE`. `ADJUSTED` signifies an accepted, reproducible transformation, not a confidence rating.

**C. Analyst decision readiness** — new independent field `READY | REVIEW | BLOCKED`.

Do **not** replace the existing five-category enum with readiness. One describes the basis of comparison; the other answers whether the requested *inference* can be drawn.

Use deterministic, documented mappings, but do not invent a simplistic 1:1 mapping:

- READY: all **required, implemented** checks have evidence and pass or show nonmaterial information; no known material blocker; coverage limits explicitly noted. This is **not** proof of complete economic comparability.
- REVIEW: data are usable for a bounded comparison, but one or more material caveats could affect interpretation; show exactly how the claim must be qualified.
- BLOCKED: a required figure is missing/unverifiable, a verified hard incompatibility exists, or the specific requested calculation cannot be supported. Preserve raw sourced figures if appropriate, but withhold the unsupported comparative conclusion.

`NOT_ASSESSED` must never silently count as PASS. If a *critical* check cannot be assessed, do not display an unqualified READY. A noncritical out-of-scope check can be labeled and excluded under a clear coverage policy. `INSUFFICIENT_EVIDENCE` should ordinarily result in BLOCKED for a metric whose needed value is missing; unlike `NOT_COMPARABLE`, it does not assert incompatible economics.

No overall opaque 0–100 score. Do not claim `READY` means investment-grade verification.

---

## 5. P0 check specifications

### 5.1 Definition integrity and tag lineage

**Goal:** Prevent two distinct financial concepts from being silently rendered under one normalized heading.

Record, per input: normalized metric ID, exact XBRL namespace and tag, reported context/period, company, source accession/filing, and whether the figure was direct or derived.

Rule tiers:

1. **Known equivalent:** tags belong to a small explicit, documented mapping and relevant contexts/period/unit match. PASS for **tag-policy mapping** only; do not assert identical company accounting policies.
2. **Different or custom tags, equivalence unresolved:** CAUTION or NOT_ASSESSED, not automatic NOT_COMPARABLE. Display both tags and a specific review action.
3. **Known concept conflict:** e.g., attributable net income versus consolidated net income including noncontrolling interests, when established from the taxonomy/concept mapping; FAIL only with verified evidence of incompatibility.
4. **No tag/source mapping:** NOT_ASSESSED or missing evidence; never infer equivalence based solely on UI metric labels.

Do not implement open-ended LLM judgments as authoritative equivalence mappings. A model can explain a deterministic result but cannot override it.

**Important:** A company-specific custom tag is a *review signal*, not proof that a measure is wrong.

### 5.2 Period integrity and severity

Validate period starts **and** ends when accessible. A year-end date gap alone is insufficient to determine coverage length, severity or whether two observations are invalid.

- Two complete, approximately equivalent annual periods with differing fiscal ends: **INFO** by default. Clearly state windows and shift; comparisons often remain useful.
- Minor ordinary filing-calendar differences: not automatic PARTIALLY_COMPARABLE or BLOCKED.
- Genuine irregular periods (e.g., short transition year, annual vs quarterly, unmatched annual coverage): **CAUTION** or **FAIL** based on whether a defensible same-duration comparison exists.
- 52-/53-week difference: flag **CAUTION** when confidently detected and pertinent; it is not automatically a 2% revenue adjustment. Never infer exact period length merely from FY label.
- Missing start dates or uncertain duration: **NOT_ASSESSED** for duration, with a cautious end-date check if possible.
- Missing/misaligned series needed for YoY growth: **BLOCKED** for the affected growth calculation, not necessarily every standalone annual metric.

**Do not hardcode severity based solely on a threshold like 30/60/90 days.** Use period type, duration, overlap and query intent; numerical thresholds, if chosen, must be documented, tested and treated as heuristics. Distinguish fact (date gap) from interpretation (materiality).

### 5.3 Historical consistency

For each company's audited metric and requested history:

- Validate required years/periods actually exist and belong to the intended annual series.
- Identify short or unusually long periods and fiscal-calendar changes when grounded by metadata.
- Identify **selected XBRL tag lineage changes**, but do not label every switch a restatement or error.
- Check for changed derivation formula across periods where the app derives the metric.
- Keep same-company longitudinal flags separate from cross-company comparability flags.
- If only a single year was requested, label multi-year checks `NOT_APPLICABLE`, not PASS.

### 5.4 Evidence and reconstruction

Each numeric cell should expose:

- `DIRECT_REPORTED`: filed XBRL fact with source link and provenance;
- `DERIVED`: exact deterministic formula, source-linked inputs, unit/period consistency, and reproducible numeric output;
- `UNAVAILABLE`: no defensible value under retrieval coverage.

Also expose evidence completeness (`VERIFIED | PARTIAL | UNVERIFIED`, or existing equivalent), and distinguish source verification from accounting-policy verification. A source reference should lead to the filing/document supporting the fact; do not fabricate precise excerpt/page claims from an accession URL alone.

A derived figure is **not intrinsically worse** than a direct figure when the formula and inputs match the requested definition. Treat it as transparent provenance, not automatic failure.

**Examples:**

- Direct reported operating income vs operating income reproducibly calculated from valid, definition-aligned inputs → potentially READY; provenance visible.
- Direct gross profit vs derived revenue minus cost of revenue → potentially REVIEW if cost classification/equivalence is unresolved.
- Missing operating income in selected SEC facts → UNAVAILABLE / INSUFFICIENT_EVIDENCE, rather than asserting the company's 10-K never contains operating-income information. Distinguish data-source coverage from a company's disclosures.

### 5.5 Formula integrity

- For identically labeled derived metrics, enforce the same canonical metric definition and valid formula across peers and years.
- Verify input provenance, periods, units and arithmetic in deterministic code.
- Reject divide-by-zero, ambiguous units, unsupported sign conventions and mixed fiscal windows for one derived ratio.
- A different *calculation path* that yields a provably equivalent canonical result may be accepted; never fail solely because one value is direct and one is calculated.
- All missing/incompatible input cases produce explicit not-comparable or insufficient-evidence states without plausible-number fill-in.

### 5.6 Currency and accounting basis

Retain existing currency, unit and GAAP/non-GAAP checks as safety checks. In the current U.S.-GAAP-focused MVP they are not the headline benefit. Do not imply an SEC filing always reports USD or always uses US GAAP. Nonmatching currency with no sourced conversion basis cannot be silently combined; if conversion is outside supported scope, mark the calculation BLOCKED while leaving original values visible.

---

## 6. Decision policy — predictable and testable

Create a small deterministic reducer over check results rather than LLM-produced statuses. Suggested order:

1. Validate existence, source, unit, context and arithmetic for **every** required input.
2. Classify known hard conflicts: verified incompatible concepts, currency/unit without defensible transform, wrong period type/duration for requested inference, invalid calculations.
3. Evaluate significant uncertainty: different/unmapped tags, derivation basis caveats, fiscal windows with material interpretive impact, unassessed critical check.
4. Mark low-risk period-end gaps and proven direct-vs-derived provenance differences as INFO when appropriate.
5. Emit readiness + per-metric caveats + `analystAction` + explicitly documented check coverage.

**Examples of policy behavior:**

| Scenario | Check classification | Readiness for affected conclusion |
|---|---|---|
| Full-year revenue, different fiscal year-ends, no other known issues | INFO timing | READY with disclosed timing caveat |
| Same metric label but differing unresolved tags | CAUTION / NOT_ASSESSED definition | REVIEW; no unqualified definition-equivalence claim |
| Proven mismatched accounting concepts | FAIL | BLOCKED until appropriately normalized |
| Reported vs valid formula-derived same concept | INFO provenance | READY if all required checks pass |
| Short transition period used as a full-year YoY comparator | FAIL for that growth inference | BLOCKED for growth; raw observation still visible |
| Required input absent from supported SEC facts | Missing evidence | BLOCKED, with source-coverage wording |
| Revision history not implemented | NOT_ASSESSED | Coverage limitation, not false negative |

**Note:** These are policy targets. If existing data lack the inputs necessary to certify a PASS, downgrade to REVIEW / NOT_ASSESSED rather than fake proof.

---

## 7. Contract / schema evolution

Prefer extending existing types and API payloads. Conceptual additions:

```ts
type Readiness = 'READY' | 'REVIEW' | 'BLOCKED';
type CheckStatus = 'PASS' | 'INFO' | 'CAUTION' | 'FAIL' | 'NOT_ASSESSED' | 'NOT_APPLICABLE';
type SourceBasis = 'DIRECT_REPORTED' | 'DERIVED' | 'UNAVAILABLE';

type IntegrityCheck = {
  id: string;
  status: CheckStatus;
  severity: 'informational' | 'material' | 'blocking';
  title: string;
  factualFinding: string;
  analyticalImplication: string;
  evidenceIds: string[];
  suggestedAnalystAction?: string;
};

type MetricIntegrityExtension = {
  readiness: Readiness;
  checkResults: IntegrityCheck[];
  assessmentCoverage: { assessed: string[]; notAssessed: string[] };
  sourceBasisByCompany: Record<string, SourceBasis>;
  analystAction: string;
  allowableConclusion?: string;
  withheldConclusionReason?: string;
};
```

This is an **illustrative interface**, not an instruction to copy it verbatim. Respect existing project schemas and validators. Preserve old fields, old status enum, old API consumers, saved audits and Markdown exports. If the interface/API cannot migrate safely, add an optional nested integrity extension and render graceful fallbacks for old audit objects.

Important: `severity` and `readiness` must be derived from policy, not just text labels assigned by the model. Require evidence IDs only for actual source-supported findings; make unavailable-evidence reasons explicit without inventing evidence IDs.

---

## 8. UX / analyst workflow

### Primary audit panel (embedded in normal research answer)

**Financial Comparison Integrity**  
**READY / REVIEW / BLOCKED** for relevant audited conclusion (not a blanket company-quality score)

- Concise verdict: "Usable for broad annual benchmarking; fiscal windows differ."
- Checks assessed: metric definition, period, calculation, evidence.
- Material cautions separated from informational observations.
- Source basis: Direct / Derived / Unavailable for each compared value.
- Coverage disclosure: "Accounting-policy and footnote equivalence not assessed."
- A single actionable next step: "Inspect tag difference" / "Use matched periods" / "Obtain source data".
- Link to current detailed audit view.

### Detailed audit screen

For every metric show:

1. Source values, dates, units, filing link, XBRL concept/tag and direct/derived status.
2. Check-by-check factual evidence, pass/caution/fail/not-assessed and consequences.
3. Any exact formula and input citations.
4. Metric's existing comparability status **and separate readiness**.
5. Allowed qualified conclusion, or precise reason the conclusion is withheld.
6. Analyst checklist. Keep existing Markdown export and include V2 fields if supported.

Do not show a green check for anything not assessed. Do not show "confirmed equivalent" where only tags match.

### Agent/research integration

When an audit exists for a comparison:

- READY → the answer may offer its comparison with the audit's scope and any informational caveat.
- REVIEW → the answer may provide provisional comparisons but must qualify the relevant inference; no confident unsupported driver attribution.
- BLOCKED → the answer may show sourced raw values, but must not state the unsupported winner/stronger trend for the blocked metric.

**Low-risk integration strategy:** prefer a server-owned, deterministic conclusion-permission field or presentation guard on audited comparisons, used consistently by the UI and answer synthesis where the existing architecture makes this feasible. Do **not** rewrite prompt orchestration or streaming to achieve a fully general answer-enforcement system. If hard enforcement would destabilize core chat, keep the warning prominently visible and explicitly document that narrative enforcement remains incomplete. Do not claim the safeguard exists merely because the panel renders.

Keep unaudited metrics and ordinary noncomparison questions unchanged. Label which metrics/claims are *not audited*.

---

## 9. P1 only: revision / restatement lineage

Requires trustworthy multiple filing candidates for a matched fiscal fact, not just the selected latest value.

If safely feasible:

1. Preserve original SEC fact selection for normal research; **never silently alter historical value-selection semantics**.
2. In the audit-only data layer, collect candidates by company, concept, unit, period start/end, frame/context as relevant, filed date and accession.
3. Surface material changed reported values with original and later filing links and deterministic delta.
4. Label this a **REVISION SIGNAL** until filing/disclosure evidence establishes the reason. Do not automatically call it an accounting restatement; changes can reflect reclassification, dimensional/context differences, company definitions or errors.
5. Avoid false revision flags from different dimensions, units, amended contexts, or periods.
6. On insufficient candidate history, return NOT_ASSESSED, not "No revisions".

Implement only after P0 tests/build pass; otherwise leave an explicit TODO and don't ship fake revision detection.

---

## 10. Safety, regression and compatibility constraints

Unless a narrow, evidenced change is strictly necessary, **do not alter**:

- Auth, user/session/thread ownership or authorization.
- Stripe, billing, quota/usage semantics or paywall logic.
- Existing financial SEC fact-selection algorithms, default chosen values or cross-year normalization semantics.
- Deterministic calculator's existing public contracts.
- Citation registry semantics / evidence ID integrity.
- Existing agent loop, gather/driver iteration limits, final-answer termination or streaming contract.
- Existing research answers, saved threads, and non-audit workflows.
- Railway/environment variable names, start/build commands or secret handling.

Avoid database migration and new dependencies where possible. Do not introduce new endpoints unless existing endpoint extension genuinely cannot support the requirement. Avoid unnecessary new external APIs. A failure of optional integrity enrichment should not crash or corrupt a successful pre-existing research response; render a clearly labeled audit-unavailable state and log structured errors.

Code changes must be scoped to the existing audit feature and minimum necessary integration points. Claude should report each file changed and why.

---

## 11. Test matrix and acceptance criteria

### Deterministic unit tests (required)

1. Two valid 12-month annual fiscal windows ending ~60–90 days apart → informational timing notice, not automatic partial/noncomparability.
2. Annual and three-month transition period → invalid full-year growth comparison; raw facts retained.
3. 52 vs 53 weeks, if source metadata allow duration classification → caution, no unsourced normalization.
4. Same supported XBRL concept with matching contexts → appropriate tag-policy pass, no unsupported assertion about policy equivalence.
5. Different/unmapped XBRL concepts → review, not automatic fail.
6. Verified parent-attributable vs consolidated-net-income concept conflict → fail/blocked.
7. Direct versus valid deterministically derived same concept → not an automatic fail.
8. Derived formula with wrong periods/units or zero denominator → block relevant calculation.
9. Required SEC structured-data value missing → insufficient evidence, not invented zero or company-disclosure claim.
10. Selected XBRL tag changed over time → lineage caution with both tags, not asserted restatement.
11. No multi-year query → historical-series check NOT_APPLICABLE.
12. Critical check unassessed → not unqualified READY.
13. Non-audited metric/query → existing answer flow unchanged.
14. Old saved audit object lacking new optional fields → backward-compatible render/export.
15. Model tries to change a deterministic status or add ungrounded numbers → rejected/not accepted.
16. Evidence URL/accession preserves source provenance; no synthetic quotes.

### Integration/regression checks (required)

- Existing `/audit` workflow and embedded comparison panel still load and render.
- Login, existing research, multi-turn conversation and answer streaming still work.
- Existing citations remain linkable and formulas remain deterministic.
- Saved audit/export path still works, including partial/missing-evidence states.
- Existing build/typecheck/tests pass; no new secrets needed.
- Stripe test flow, if test environment available, is unaffected.
- Audit failure does not bring down a previously successful normal research response.

### Real-filing evidence cases

**Nike vs Under Armour** — period timing and any actually observed missing SEC concept, explicitly caveating structured-data coverage. Do not hardcode "61 days" or "Nike never reports operating income"; verify live facts and relevant year.

**Home Depot vs Lowe's** — anticipated lower-warning baseline, but actual statuses must follow retrieved facts, not a predetermined all-green demo.

**Known taxonomy mismatch** — select a verified example in current data. Do not stage fictional company conclusions in production flows.

**IFRS/foreign filer** — existing graceful insufficient-evidence handling, not a new normalization capability.

### Ship definition

- P0 logic implemented with deterministic tests and actual-source evidence.
- User can tell, per metric, **what was checked**, **what failed or was not assessed**, **whether the conclusion is usable**, and **what to do next**.
- Existing five-status contract and integrations remain compatible.
- No known regressions in non-audit workflows; documented gaps and tests results.

---

## 12. Recommended implementation sequence

**Step 0 — Review:** Inspect repository; map concrete files/contracts. Give a 5–10-line implementation plan before editing.

**Step 1 — Contract:** Add optional check-result/readiness/provenance fields with runtime validation and backward compatibility. Implement deterministic decision reducer; write unit tests.

**Step 2 — Data checks:** Adjust fiscal period severity, surface tag mappings and lineage, add direct/derived/unavailable and formula assertions. Avoid changes to selected SEC facts.

**Step 3 — UI:** Add readiness headline, check summary, not-assessed coverage, provenance badges/labels and analyst actions to embedded panel and detail view. Ensure legacy audits still render.

**Step 4 — Narrative interaction:** Hook deterministic decision into audit answer presentation at a minimal stable integration point; avoid claiming hard enforcement without tests.

**Step 5 — Verification:** Build, typecheck, test and run evidenced comparisons. Record exact commands, results, remaining limitations and changed files.

**Step 6 — Optional P1:** Revision signals only if P0 is stable and candidate fact data can be accessed without altering production fact selection.

---

## 13. Evaluation: what improvement means

Track testable product outcomes rather than abstract confidence:

- False blocking-warning rate for normal full-year peers should decrease.
- Unresolved tag differences are visible without being mislabeled automatically as economic conflicts.
- No unsupported missing-input calculations proceed.
- Every audited derived value has a repeatable formula and sourced inputs.
- Each evaluated metric gets a decision-ready recommendation and coverage disclosure.
- Unimplemented checks never show misleading green pass states.
- No regression in existing research, auth, payment or streaming experience.

## 14. Definition of done and final handoff

Claude Code must finish with:

1. Summary of functionality actually implemented, organized P0 vs P1.
2. Exact file list and purpose of changes.
3. Test/build commands with pass/fail results.
4. At least two real company case results with source-backed factual findings and any unresolved questions.
5. Known limitations and any enforcement not actually wired end-to-end.
6. Required environment/deployment changes (ideally none).
7. Any uncompleted functionality plainly labeled, not presented as shipped.

**Final instruction:** Make this a better *decision-support and evidence-integrity* experience, not a broader autonomous auditor. Preserve existing Comps reliability and behavior first.
