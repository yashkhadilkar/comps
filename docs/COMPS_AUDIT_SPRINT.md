# Comps Audit — 150-Minute Product Sprint

**Sprint window:** Wednesday, 1:30 PM–4:00 PM  
**Deployment:** Railway, with Yash after 4:00 PM  
**Product:** Comps — AI-powered financial research and comparability auditing  
**Priority:** Working end-to-end product > additional features > visual polish  
**Operating principle:** Preserve every existing working feature.

---

# 1. Executive Decision

## Product direction

Evolve Comps from a financial research assistant into an **evidence-backed financial comparability auditor**.

### Existing product

Comps already supports financial research, company comparisons, SEC-based evidence, multi-turn research, calculations, contextual analysis and payment functionality.

These capabilities remain part of the product.

### New product proposition

> Comps helps analysts determine whether two companies' reported financial metrics can actually be compared, identifies material inconsistencies, and generates a source-backed audit trail explaining what is comparable, what requires adjustment, and what cannot be verified.

This is not a replacement for a formal financial statement audit. It is an AI-assisted comparability review of public-company disclosures.

### Target user

Primary: junior equity research analysts, investment analysts and finance students preparing peer comparisons.

Their problem is not simply finding revenue or margins. It is establishing whether figures from different companies represent equivalent economic concepts.

### Why AI?

Comparability analysis involves interpreting accounting policies, reporting periods, segment definitions, non-GAAP adjustments and explanatory footnotes. This requires contextual reasoning over semi-structured documents, while numerical calculations require deterministic verification.

Our system should combine both.

### Honest differentiation

We are not claiming to have invented AI financial research.

Comps demonstrates an integrated workflow combining retrieval, evidence attribution, financial normalization, deterministic calculations, structured LLM reasoning and auditable outputs.

Our novelty, if any, is in the specific comparability contract and review workflow—not the underlying language model.

---

# 2. The Comparability Contract

The central engineering deliverable is a structured, testable contract governing every audit.

## 2.1 Required output

Each metric comparison must include:

- Metric name and standardized definition
- Company identifiers
- Reporting periods and period types
- Units and currency
- Original reported values
- Source documents and evidence references
- Reporting basis, including GAAP or non-GAAP where relevant
- Normalization or adjustment details
- Adjusted values, if defensible
- Comparability status
- Material caveats
- Verification status
- Confidence or evidence-quality classification
- Human-review requirement where necessary

## 2.2 Comparability statuses

Use a fixed enum:

**COMPARABLE** — Definitions, periods, units and reporting bases are sufficiently aligned.

**ADJUSTED** — A documented, reproducible transformation was required.

**PARTIALLY_COMPARABLE** — Some dimensions align, but meaningful limitations remain.

**NOT_COMPARABLE** — A material incompatibility prevents a valid direct comparison.

**INSUFFICIENT_EVIDENCE** — The available sources do not support a defensible conclusion.

Do not collapse missing evidence into NOT_COMPARABLE.

## 2.3 Contract invariants

1. Every reported number must have a traceable source.
2. Every adjusted number must have a reproducible calculation.
3. A missing source cannot be replaced by a plausible estimate without explicit labeling.
4. LLM-generated arithmetic is never the authoritative calculation.
5. Currency conversion requires a documented rate and relevant date.
6. Fiscal-year differences must be disclosed.
7. Non-GAAP metrics cannot silently be compared with GAAP metrics.
8. Confidence is not a substitute for source evidence.
9. Contradictory sources must produce a visible warning.
10. The system must support a partial audit when one or more metrics fail.
11. Unsupported adjustments must be rejected rather than fabricated.
12. The final report must preserve the distinction between reported and normalized values.

## 2.4 Suggested TypeScript model

```ts
type ComparabilityStatus =
  | "COMPARABLE"
  | "ADJUSTED"
  | "PARTIALLY_COMPARABLE"
  | "NOT_COMPARABLE"
  | "INSUFFICIENT_EVIDENCE";

type EvidenceQuality =
  | "VERIFIED"
  | "PARTIAL"
  | "UNVERIFIED";

interface AuditEvidence {
  sourceId: string;
  documentTitle: string;
  documentUrl: string;
  filingDate?: string;
  accessionNumber?: string;
  excerpt?: string;
}

interface AuditValue {
  companyId: string;
  reportedValue: number | null;
  normalizedValue: number | null;
  currency?: string;
  unit: string;
  fiscalPeriod: string;
  periodType: string;
  reportingBasis?: string;
  evidence: AuditEvidence[];
}

interface AuditAdjustment {
  description: string;
  formula: string;
  inputSourceIds: string[];
  outputValue: number;
}

interface MetricAudit {
  metricId: string;
  definition: string;
  values: AuditValue[];
  adjustments: AuditAdjustment[];
  status: ComparabilityStatus;
  evidenceQuality: EvidenceQuality;
  caveats: string[];
  explanation: string;
  requiresHumanReview: boolean;
}

interface ComparabilityAudit {
  auditId: string;
  companies: string[];
  metrics: MetricAudit[];
  generatedAt: string;
  overallAssessment: string;
  limitations: string[];
}
```

Adapt these interfaces to the existing repository conventions rather than creating a competing data architecture.

---

# 3. Product Experience

## Main user journey

1. User opens Comps.
2. Selects two public companies.
3. Selects financial metrics and reporting period.
4. Clicks **Run Comparability Audit**.
5. System retrieves available financial facts and disclosure evidence.
6. Deterministic validation checks units, periods, definitions and numerical consistency.
7. AI analyzes semantic differences and proposes supported adjustments.
8. Contract validation accepts or rejects proposed adjustments.
9. User receives a structured audit report.
10. User can inspect evidence and continue researching in the existing Comps interface.

## Essential screen

### Audit overview

Show:

- Company A versus Company B
- Period under review
- Number of metrics reviewed
- Comparable metrics
- Metrics requiring adjustment
- Metrics requiring human review
- Metrics with insufficient evidence

Avoid presenting an arbitrary overall numerical audit score.

### Metric review cards

Each card should show:

**Revenue**

Company A: reported figure  
Company B: reported figure

Status: COMPARABLE / ADJUSTED / etc.

**Why this matters:** Plain-English explanation.

**Evidence:** Source links and supporting excerpts.

**Adjustment:** Formula and calculation, if applicable.

**Analyst action:** Accept, investigate, or flag for review.

### Final report

Produce a coherent, shareable report containing:

- Executive assessment
- Metric-by-metric findings
- Adjustments
- Source references
- Limitations
- Items requiring analyst review

Markdown export is sufficient for the first sprint. PDF export is optional.

---

# 4. Sprint Schedule

## 1:30–1:40 — Repository reconnaissance and baseline

**Goal:** Identify existing infrastructure and protect working functionality.

Claude Code tasks:

- Inspect application routes, data-fetching functions and existing comparison services.
- Identify SEC/XBRL integrations and evidence models.
- Inspect AI provider configuration and orchestration.
- Locate authentication, Stripe and existing persistence.
- Identify deployment configuration and environment variables.
- Run existing tests and build checks.
- Record the current working commit.

**Deliverable:** A brief architecture inventory and implementation plan mapped to real files.

**Hard rule:** Do not rewrite the existing research pipeline.

## 1:40–2:05 — Comparability contract and deterministic engine

**Priority: P0**

Implement:

- TypeScript schemas
- Runtime validation, using existing validation libraries where available
- Period compatibility checks
- Currency and unit compatibility checks
- GAAP/non-GAAP basis checks
- Deterministic normalization
- Evidence presence checks
- Adjustment validation
- Explicit missing-data states

Start with three metrics:

1. Revenue
2. Operating income
3. Operating margin

Operating margin must be computed from verified inputs, not accepted blindly from the model.

### Tests

- Matching reporting periods
- Different fiscal periods
- Missing evidence
- Unit mismatch
- Currency mismatch
- Division by zero
- Unsupported adjustment
- Conflicting financial facts
- Partial metric failure

**Acceptance criterion:** The deterministic layer returns valid audit objects without requiring an LLM.

## 2:05–2:35 — AI audit workflow

**Priority: P0**

Build a bounded agentic workflow.

### Step A — Retrieve

Reuse existing SEC filing and financial data infrastructure.

### Step B — Inspect

Determine which financial values and explanatory disclosures are available.

### Step C — Analyze

Ask the LLM to identify:

- Accounting definition differences
- Reporting-period differences
- Relevant disclosure caveats
- Potentially material inconsistencies
- Supported normalization opportunities

### Step D — Verify

Validate every proposed adjustment against the deterministic contract.

### Step E — Report

Generate the final structured audit from accepted facts, adjustments and caveats.

### Failure handling

- Retry recoverable model failures within a fixed limit.
- Handle invalid structured outputs.
- Handle rate limits and timeouts.
- Handle unavailable SEC data.
- Never convert missing evidence into confident assertions.
- Preserve partial results where possible.
- Return actionable errors without exposing secrets.

### Observability

Capture:

- Audit ID
- Processing stages
- Stage durations
- Model usage, where available
- Validation failures
- Retrieval failures
- Final audit status

**Acceptance criterion:** One real company pair produces a source-backed audit without manual database intervention.

## 2:35–3:05 — Audit UI and existing-product integration

**Priority: P0**

Create an audit entry point within the existing application.

Required:

- Company selectors
- Metric selection
- Run button
- Progress states
- Audit overview
- Metric result cards
- Evidence links
- Caveat display
- Partial failure states

Reuse existing components and styling.

Avoid adding a separate design system.

### Stretch

- Expandable evidence drawer
- Analyst review checklist
- Audit history
- Markdown export

**Acceptance criterion:** The entire workflow is navigable in the browser and produces interpretable results.

## 3:05–3:25 — Evaluation and adversarial tests

**Priority: P0**

Test the audit against deliberately difficult cases.

### Test case 1 — Straightforward comparison

Two companies with available same-period GAAP revenue data.

Expected: Correct values, evidence and defensible comparability status.

### Test case 2 — Fiscal-period mismatch

Use data from different reporting periods.

Expected: Warning or normalization only when justified.

### Test case 3 — Non-GAAP mismatch

One value is adjusted EBITDA and the other is GAAP operating income.

Expected: NOT_COMPARABLE unless a properly sourced reconciliation supports a defined adjustment.

### Test case 4 — Missing evidence

One company's metric is unavailable.

Expected: INSUFFICIENT_EVIDENCE, not a fabricated value.

### Test case 5 — Invalid arithmetic

Inject a deliberately inconsistent adjustment into a unit test.

Expected: Validation failure.

### Test case 6 — Source contradiction

Two sources disagree on a financial value.

Expected: Visible conflict and human-review flag.

Measure:

- Schema validity
- Evidence coverage
- Arithmetic correctness
- Expected status classification
- Graceful failure behavior
- End-to-end completion

Record actual results. Do not claim perfect accuracy unless demonstrated.

## 3:25–3:40 — Hardening and feature freeze

**Priority: P0**

At 3:25, stop adding functionality.

Tasks:

- Run production build.
- Run automated tests.
- Check for TypeScript errors.
- Verify login.
- Verify existing research and comparisons.
- Verify conversational workflow.
- Verify Stripe sandbox flow.
- Verify audit workflow.
- Confirm secrets are server-side.
- Confirm user-visible error states.
- Check environment-variable requirements.
- Update README.

Any incomplete stretch feature should be disabled or removed.

## 3:40–4:00 — Deployment handoff and demo preparation

**Priority: P0**

Prepare for the call with Yash.

- Commit stable changes.
- Prepare Railway environment-variable checklist.
- Confirm build and start commands.
- Confirm database migrations, if any.
- Confirm Stripe sandbox webhook requirements.
- Prepare smoke-test instructions.
- Identify rollback commit.
- Record known limitations.
- Rehearse a three-minute demo.
- Assign deployment responsibilities.

**4:00 PM deliverable:** A release candidate, not an untested development branch.

---

# 5. Ambitious Stretch Backlog

Only begin these after the P0 journey works.

## P1 — Audit evidence explorer

Let users expand each metric into its source documents, excerpts, calculation inputs and adjustment rationale.

**Value:** Makes the system inspectable rather than merely conversational.

## P1 — Analyst review workflow

Allow users to mark findings as:

- Reviewed
- Accepted
- Needs investigation

Persist the review status if existing infrastructure makes this straightforward.

Do not imply that an accepted finding is independently certified.

## P1 — Audit export

Generate a Markdown report that can be saved or shared.

Include all material caveats and source references.

## P1 — Comparison sensitivity

Show how a supported adjustment changes a calculated metric or relative comparison.

Only use verified inputs.

## P2 — Multi-company audits

Expand from two companies to a peer set.

Avoid this until the two-company contract is reliable.

## P2 — Audit history and change detection

Store audit snapshots and show changes when new financial filings become available.

This is a compelling longer-term feature but requires durable data/version management.

## P2 — Source reconciliation agent

Detect discrepancies between financial sources and present a structured resolution queue.

## P2 — Analyst-defined metric definitions

Allow analysts to specify the financial concept they intend to compare, then verify whether available data satisfies that definition.

---

# 6. Technical Architecture

Use the existing architecture wherever possible.

```text
Existing Comps Application
          |
          +-- Research / Chat / Comparison
          |
          +-- Comparability Audit UI
                     |
                     v
              Audit API Route
                     |
                     v
              Audit Orchestrator
                     |
          +----------+----------+
          |                     |
          v                     v
   Existing Financial      LLM Analysis
   Data + SEC Retrieval    Structured Output
          |                     |
          +----------+----------+
                     |
                     v
             Contract Validator
                     |
                     v
           Deterministic Calculator
                     |
                     v
              Audit Report
                     |
          +----------+----------+
          |                     |
          v                     v
      Audit UI             Export / Storage
```

### Engineering rules

- Preserve existing API contracts.
- Reuse existing data clients.
- Do not duplicate authentication logic.
- Do not introduce unnecessary infrastructure.
- Avoid database migrations unless essential.
- Keep AI orchestration server-side.
- Do not expose API keys in client bundles.
- Add strict timeouts and bounded retries.
- Preserve source provenance through every transformation.
- Validate all model-generated structured outputs.
- Make partial failure a supported state.
- Never represent an LLM conclusion as a deterministic fact.

---

# 7. Product and Engineering Tradeoffs

## What we will not build today

- A complete accounting rules engine
- Universal GAAP-to-IFRS reconciliation
- Full multi-company valuation modeling
- A comprehensive market-data platform
- Automated professional audit certification
- A new authentication or payment system
- A replacement for the existing research interface
- A complicated multi-agent framework solely for demonstration

## Why

These features increase implementation risk without proportionately improving the grading outcome.

The sprint should demonstrate depth in one workflow rather than superficial breadth.

---

# 8. Rubric Alignment

## Business problem and product thinking — 15 points

Demonstrate:

- Clear target user
- Specific financial comparison problem
- Why ordinary search is insufficient for reliable comparability checks
- Why LLM interpretation is useful
- Why deterministic validation is necessary

Be explicit that this is an MVP and that commercial demand has not yet been validated.

## Implementation completeness — 25 points

Demonstrate:

- Working login
- Existing financial research functionality
- AI-backed workflow
- Functional payment flow
- Complete audit journey
- Error states

A smaller complete audit is worth more than an elaborate unfinished system.

## AI design framework — 20 points

Explain:

- Retrieval-augmented analysis
- Agentic orchestration
- Structured outputs
- Tool usage
- Deterministic calculations
- Runtime validation
- Evidence attribution
- Error handling
- Model failure recovery
- Hallucination mitigation

The strongest demonstration is showing a case where the model proposes something invalid and the validation layer rejects it.

## Deployment and production readiness — 15 points

Show:

- Live Railway URL
- Working Stripe sandbox checkout
- Correct secret management
- Graceful failures
- Reliable production build

## Engineering quality — 10 points

Provide:

- Clean repository
- README
- Architecture diagram
- Tests
- Design decisions
- Documented limitations

## Write-up — 10 points

Create a concise 4–5-page document.

Suggested structure:

1. Problem, users and scope
2. Product and implementation
3. AI architecture and design decisions
4. Evaluation, challenges and limitations
5. Deployment, teamwork and lessons learned

## Teamwork and presentation — 5 points

Demonstrate actual contributions, not equal contributions invented for appearance.

Acknowledge the one-week timeline and teammates' external commitments factually, without making them the centerpiece of the presentation.

---

# 9. Presentation Strategy

## Opening

> We built Comps, an AI-powered financial research platform, in one week. Our goal was to reproduce a useful subset of the workflow offered by established AI financial research tools and apply the LLM engineering techniques learned in class.
>
> We extended the product with a comparability audit workflow because retrieving two financial numbers is not the same as establishing whether those numbers can be meaningfully compared.

## Demo sequence

**First 30 seconds:** Show the existing product, login and core research experience.

**Next 45 seconds:** Demonstrate a real company comparison with source evidence.

**Next 75 seconds:** Run a comparability audit and inspect its metric statuses, calculations, caveats and sources.

**Next 30 seconds:** Demonstrate an error or edge case handled safely.

**Final 30 seconds:** Explain architecture, production deployment and key lessons.

Demonstrate Stripe sandbox separately if the presentation format permits.

## Claims to avoid

- "We built a better Fintool."
- "Our financial analysis is always accurate."
- "Our system audits financial statements."
- "Our agents autonomously verify everything."
- "This is a completely novel product."

## Claims we can defend if implemented

- "We built a functional financial research MVP."
- "We integrated LLM reasoning with structured financial data."
- "We implemented evidence-backed comparability checks."
- "We validate numerical adjustments deterministically."
- "We explicitly handle missing evidence and unsupported conclusions."
- "We deployed the application and tested its core workflows."

---

# 10. Release Criteria

## Minimum acceptable release

- Existing application remains functional.
- Audit can run for one real company pair.
- Three financial metrics are supported.
- Results satisfy the comparability contract.
- Evidence is displayed.
- Arithmetic is deterministic.
- Missing evidence is handled correctly.
- Production build passes.
- Stripe sandbox remains functional.
- Deployment documentation is complete.

## Strong release

All minimum requirements, plus:

- Evidence explorer
- Analyst review actions
- Markdown export
- Automated adversarial test suite
- Saved audit history

## Exceptional release

All strong-release requirements, plus:

- Reproducible source reconciliation
- Adjustment sensitivity analysis
- Multiple-company support
- Strong audit observability
- Comprehensive evaluation report

Exceptional is aspirational, not a release requirement.

---

# 11. Kill Criteria and Fallback

## 2:05 checkpoint

If the comparability contract cannot reliably represent available financial data, narrow the metric scope to revenue and operating income.

## 2:35 checkpoint

If the AI audit workflow cannot reliably produce grounded results, use deterministic checks plus AI-generated explanations that are explicitly limited to verified inputs.

Do not fabricate an end-to-end agent workflow.

## 3:05 checkpoint

If the UI is incomplete, use a minimal audit results page instead of a polished dashboard.

## 3:25 checkpoint

If the audit extension threatens existing functionality, disable the audit entry point and preserve the original application.

## Final fallback framing

If the audit workflow cannot be delivered safely, present Comps as:

**An end-to-end AI financial research MVP inspired by established financial research platforms, built in one week to demonstrate practical LLM application engineering.**

This is consistent with the professor's clarification that reproducing existing products is acceptable.

The grade should not depend on unproven novelty.

---

# 12. Instructions for Claude Code

Before writing code:

1. Inspect the repository.
2. Identify existing reusable services and components.
3. Map the proposed changes to actual files.
4. Run the existing test/build baseline.
5. Identify anything that could break deployment.

Then implement the P0 sprint in sequence.

Work autonomously within the existing architecture.

Prioritize production-quality integration over abstractions.

Do not rewrite working modules without clear necessity.

Use real financial data in production flows. Test fixtures are acceptable only for automated tests or clearly labeled demonstrations.

Run relevant tests after each milestone.

Report completed features, uncompleted features, known limitations and deployment risks.

**Final instruction: A complete, defensible two-company audit is the objective. More features are valuable only after that works.**