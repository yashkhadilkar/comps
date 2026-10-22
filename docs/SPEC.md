# SPEC — Comps

> Exhaustive implementation specification for Comps.
>
> The PRD explains **why** the product exists. This file states **exactly what the build must do**.
> When implementation changes a behavior deliberately, change this spec first or in the same commit and record the deviation in `BIG_AUDIT.md`.

## 0. Authority and scope

### 0.1 Authority

Where prose disagrees with executable contracts, executable contracts win:
- `lib/agent/types.ts`
- tool JSON schemas
- Supabase migrations
- `lib/plans.ts`

Then this `SPEC.md`, then `ARCHITECTURE.md` / `DESIGN.md`, then active step plans.

### 0.2 Product scope

Comps answers fundamental-analysis questions about **US SEC filers** using:
- SEC company/ticker data
- SEC company facts / 10-K data
- a safe calculator
- optional Tavily news context

It is for medium/long-term investors and in-house analysts. It is not a trading system.

### 0.3 Current release scope

In scope:
- Supabase auth
- ReAct agent
- 4 research tools + structured final answer
- streamed trace and cited answer
- run persistence
- 3 free successful questions
- one-time $19 Pro upgrade in Stripe test mode
- 25 successful Pro questions per UTC day
- Railway deployment

Out of scope:
- real-time prices
- buy/sell/hold recommendations
- short-term price forecasts
- non-SEC company financials
- subscriptions
- team accounts
- charts
- user-facing saved-history product
- production-grade distributed rate limiting

---

## 1. Product requirements

### PROD-001 — Core benchmark
The user can ask for multi-year fundamentals for one company or comparisons across 2–3 SEC-filing companies.

### PROD-002 — Supported metric family
The agent supports the metric family already implemented in Step 2:
- revenue
- cost of revenue
- gross profit
- operating income
- net income
- operating cash flow
- inventory

Derived margins, growth, and CAGR are calculated through the calculator tool.

### PROD-003 — Honest coverage
If data is unavailable, Comps says so. It does not estimate or fill missing years from model memory.

### PROD-004 — No trading advice
Buy/sell/hold recommendations, price targets, and short-term price predictions return a declined response and redirect toward fundamentals.

### PROD-005 — Non-SEC companies
A company outside supported SEC coverage returns a clean `not_covered` response. Do not fabricate its financials.

---

## 2. Authentication and request entry

### AUTH-001 — Auth required
`POST /api/agent` requires a valid Supabase user session.

If unauthenticated, it returns a JSON error before streaming starts.

### AUTH-002 — Validate before streaming
Question parsing/validation, auth, and usage checks happen before the NDJSON body begins. Once streaming begins, HTTP status cannot be repurposed for later agent failures.

### AUTH-003 — Privileged writes stay server-side
The browser never receives or uses the Supabase secret/service key. Privileged plan updates happen server-side only.

---

## 3. Usage and plans

### PLAN-001 — Free allowance
A free user is allowed to start a new agent run while they have **fewer than 3 `success` runs total**.

### PLAN-002 — What counts
Only a run whose agent result status is `success` counts against usage.

Clarifications, declined requests, off-topic responses, not-covered responses, insufficient-data responses, and failed runs do not consume a question.

### PLAN-003 — Pro allowance
A Pro user is allowed to start a new run while they have **fewer than 25 `success` runs in the current UTC calendar day**.

Recommended reset semantics:
- day boundary: `00:00:00Z`
- `resetAt`: next UTC midnight as an ISO timestamp

This avoids dependence on Railway host timezone.

### PLAN-004 — Usage denial contract
When usage is denied, `/api/agent` returns JSON before streaming with HTTP `402`.

Canonical response:
```json
{
  "error": "human-readable message",
  "code": "FREE_LIMIT_REACHED | DAILY_LIMIT_REACHED",
  "usage": {
    "plan": "free | pro",
    "used": 3,
    "limit": 3,
    "resetAt": null
  }
}
```

For Pro daily limits, `resetAt` is non-null.

### PLAN-005 — Count from runs
The usage count is derived from persisted `runs`; there is no independent counter to drift out of sync.

Known limitation for this capstone: simultaneous requests can pass the count check before either success is persisted. Document this as a production hardening item rather than changing the schema under deadline pressure.

---

## 4. Agent loop

### AGENT-001 — Model
Model is selected by `LLM_MODEL`.
- development default: Haiku 5.5
- demo: Sonnet 5.5

### AGENT-002 — Bounded loop
The agent has:
- max 6 iterations; max 8 for why/driver questions (deterministic wording check in `lib/agent/intent.ts`, no LLM classifier). The deadline, hard limit, tool timeouts, retry and forced-final step are the same for both ceilings
- ~90 second internal deadline
- route max duration 120 seconds (`maxDuration` is only a hint to deployment platforms; Railway's `next start` does not enforce it, so the loop enforces its own limits: 90s soft deadline, 115s hard limit)

If the loop must stop, it returns the best honest partial/insufficient answer it can, not a fabricated complete answer.

### AGENT-003 — ReAct trace
Each tool decision produces user-visible trace data:
- thought
- action
- observation

The trace is a product artifact, not merely server logging.

### AGENT-004 — Structured termination
The normal agent termination path is a structured `final_answer` tool call.

### AGENT-005 — Final answer kinds
Allowed answer kinds:
- `answer`
- `clarification`
- `not_covered`
- `declined`
- `off_topic`
- `insufficient_data`
- `error` (system-generated only, see below)

Only `answer` maps to run status `success`.

A sixth system-only kind, `error`, is used when the AI service or the server fails (or the run is cancelled). The model is never offered it, so a provider failure is distinguishable from "no data" (`insufficient_data`). It is saved as `failed`.

### AGENT-006 — Parallel independent work
Independent tool calls may run in parallel in one iteration.

### AGENT-007 — Tool failures
Tool exceptions/timeouts do not crash the loop. The executor returns an explicit failure result to the model after the allowed retry behavior.

### AGENT-008 — No silent provider failure
A provider/API failure must produce a failed agent result or explicit user-facing error. It must never masquerade as "no data found."

### AGENT-009 — Ambiguous company names
If `lookup_ticker` returns `ambiguous`, the run may not answer with figures. The final answer is forced to `kind: "clarification"` with a structured `clarification` (`query`, original `question`, max 3 `options`), whatever the model submitted.
- The model chooses which candidates to offer (`clarification_options`), best first. The server accepts only tickers `lookup_ticker` returned, shows the tool's company names, and never offers a low-confidence fuzzy hit while a stronger candidate exists. With no valid choice it falls back to the tool's strongest candidates.
- Each option carries the user's question rewritten with the **ticker** in place of the ambiguous name (a ticker is an exact lookup).
- The prompt requires looking companies up exactly as the user wrote them. A model that expands a name itself ("Delta" to "Delta Air Lines") bypasses the guard, so this is verified on Sonnet.

---

## 5. Tool contracts

### TOOL-001 — `lookup_ticker`
Purpose:
- resolve ticker/company identity from the SEC ticker list
- support typo/fuzzy matching
- return `match`, `ambiguous`, or `not_found`
- dedupe multiple tickers for the same CIK

Behavior:
- clear fuzzy match may be used with an "assuming you meant..." note
- ambiguous result must not be guessed

### TOOL-002 — `get_financials`
Purpose:
- fetch annual US-GAAP company facts from SEC EDGAR

Required properties of every returned value:
- fiscal year label
- actual period end date
- raw numeric value
- display string
- form/filed metadata
- XBRL tag used
- citation key

### TOOL-003 — SEC annual-period rules
For duration metrics:
- use 10-K / 10-K/A facts
- keep roughly annual durations
- dedupe by period end date
- latest filed value wins for that end date

Fiscal-year labels are derived from period-end logic, not blindly from SEC `fy`.

### TOOL-004 — Tag fallback/merge
When companies change XBRL tags over time, merge period coverage across the ordered fallback tag list. Do not stop after the first tag with any data.

### TOOL-005 — `calculate`
All arithmetic is delegated to a restricted calculator tool.
- never use `eval`
- only digits, `+ - * / ^`, parentheses and exponent notation are accepted (no `%`, no commas)
- reject unsafe expressions
- one bad expression does not fail the whole batch
- up to 50 calculations per call; any beyond that come back as per-item errors telling the model to resend them (they are never silently dropped; before A11 the cap was a silent 20)
- non-finite results are errors

### TOOL-006 — `search_news`
News is optional explanatory context, not the source of core reported financial figures.

Search content is wrapped and explicitly treated as untrusted third-party text.

Input is `{thought, query, from_year, to_year}`. `from_year`/`to_year` (calendar years, 2000 to now) become a Tavily `start_date`/`end_date` window so a search can reach the period being explained; 0, missing or invalid values fall back to the last 12 months (older callers sending only `thought` and `query` keep working).

### TOOL-007 — Tool timeout + retry
Each external/tool execution has a timeout. A thrown error or timeout is retried once by the executor. A normal tool-level negative result such as "not found" is not retried as though it were a transport failure, and neither are errors retrying cannot fix (`NonRetryableError`: bad credentials, missing config, 403/404/401). A timed-out attempt is aborted so the retry does not run alongside it.

---

## 6. Citations and answer correctness

### CITE-001 — Retrieved-source only
Every source shown to the user must originate from a tool result in the same run.

### CITE-002 — Server-side resolution
The model emits citation keys. The server resolves them against the run citation registry.

Unknown keys are dropped.

### CITE-003 — Numeric grounding
Every displayed financial figure in answer prose or structured tables must be grounded in retrieved financial data and associated with a source marker.

### CITE-004 — Missing data
Missing years/metrics must be named in notes or prose. Never interpolate unless a future spec explicitly adds such a feature.

### CITE-005 — Fiscal-year clarity
When compared companies have different fiscal year ends, period-end dates are displayed so the comparison is not presented as perfectly calendar-aligned.

---

---

## 6A. Driver ("Why?") analysis

Source: `docs/ANALYST_DRIVER_ANALYSIS_PLAN.md`. Implemented in the system prompt (`lib/agent/prompt.ts`, "Why questions") and the `search_news` date window. No new tool, answer field, loop change, limit change or schema.

### DRIVER-001 — Intent
Why / what caused / what drove / what explains / has it recovered questions are diagnostic. Plain figure or comparison questions are not and must not call `search_news` (unless the user explicitly asks for news or context).

### DRIVER-002 — Numbers first
For a diagnostic question the movement is established from `get_financials` and `calculate` (the changing years identified) before any `search_news`. `search_news` is never the first evidence step and never shares a turn with `get_financials`. Expected shape: `lookup_ticker`, `get_financials`, `calculate`, `search_news`, `final_answer`, inside the existing 6-iteration cap.

### DRIVER-003 — Specific, period-aligned queries
Queries name the company (common name), metric, direction and fiscal years, and set `from_year`/`to_year`. Peer questions search each company separately; recovery questions may search the decline and recovery periods separately. At most two searches per question.

### DRIVER-004 — Filings stay authoritative
Every financial figure comes from `get_financials`/`calculate`. An article figure that conflicts with the filing-derived figure never replaces it (existing CITE-003 flags article-only figures as unmatched).

### DRIVER-005 — Fact, inference, reported cause
Answers keep three claim types distinct: filing facts, analytical inference from retrieved data (labelled as inference), and reported drivers. Lead with the takeaway; state what remains uncertain. Deterioration and recovery are explained separately.

### DRIVER-006 — Causal language
Cautious language ("appears to", "reported factors included", "coincided with"); no "proves", "definitely caused", "sole reason"; no quantified effect for a cause unless a source gives it.

### DRIVER-007 — Contextual citations
Each sentence stating a reported driver ends with the `news-N` marker it came from. Filing keys do not support article claims. Unknown keys are dropped as before (CITE-002).

### DRIVER-008 — Limited evidence
If `search_news` fails or returns nothing relevant, the quantified filing analysis is still returned as `kind: "answer"` with a plain statement that contextual evidence was limited. No invented drivers. A tool error is shown to the model as an error, never as an empty result (AGENT-008).

### DRIVER-010 — Efficient trajectory and iteration ceiling
Driver questions may use up to 8 iterations (normal questions stay at 6); the wall-clock deadline is unchanged. The extra budget is insurance for a clarification, a missing-metric fallback or a second search pass. The target run is 5 steps: lookup, financials, one batched `calculate` (margins, YoY and percentage-point changes, implied operating expenses and their margin, for all years and companies), parallel `search_news` calls (one per material phase or company, at most 3 in total), final answer.

### DRIVER-011 — Material phases
Years are grouped into phases (for example improvement and deterioration). Movements of about two percentage points or more are material and get searched; sub-point movements are folded into the neighbouring phase or left out. A broad "what drove the changes" question covers every material phase.

### DRIVER-012 — No process-limit language
Answers never say "I did not look for", "I ran out of steps" or mention step/time budgets. Weak evidence is stated as "I did not find reliable evidence explaining ...". The forced-final step, its trace line and its nudge use neutral wording and ask for what is established, what is supported and what remains uncertain.

### DRIVER-009 — Boundaries unchanged
Buy/sell/hold and price-prediction handling, prompt-injection wrapping (SEC-004), iteration/deadline/retry limits and non-answer kinds are unchanged. A mixed "why did margins fall, and should I buy" question is answered as the diagnostic plus a statement that Comps gives no buy/sell advice.

---

## 6B. Threads and continuation

### THREAD-001 — Ownership
Every run belongs to one thread and one user. The server never trusts a browser-supplied `threadId`: it loads the thread by id AND authenticated user before any usage check or model spend. A missing, malformed or foreign thread returns 404 with the same body. The client never sends conversation history.

### THREAD-002 — Creation
A new conversation creates its thread only after auth, validation and the usage check pass. Title = trimmed first question, max 120 characters. Failed runs attach to the thread like any run.

### THREAD-003 — Context bound
A follow-up receives the latest 3 successful runs of the thread, oldest first: question (max 1000 chars) and answer prose plus notes (max 2500 chars), deterministically truncated, with citation markers removed. No sources, tables, traces or tool output. A context load error fails the request.

### THREAD-004 — Grounding isolation
Prior turns are context only. The agent must re-fetch every financial or news figure it cites; the citation registry is built only from the current run's tools; newly fetched tool output wins over any earlier figure. Clarification logic still applies.

### THREAD-005 — Usage independence
Usage still counts successful `runs` per user exactly as PLAN-001..005. Threads are never counted.

### THREAD-006 — History
History lists threads by `updated_at` desc with title and question count. `/history/[threadId]` rebuilds every saved turn from Supabase and continues the same thread. "New question" starts a new thread.

## 7. Streaming API contract

### STREAM-001 — Format
`POST /api/agent` streams newline-delimited JSON (`application/x-ndjson`).

### STREAM-002 — Event types
The shared `AgentEvent` type is authoritative. Current semantic event sequence:
- zero or more `step`
- zero or more `answer_delta` while the final answer is being written (see STREAM-006)
- then exactly one `final`
- then optionally one `audit` (STREAM-007)
- or an `error` if the route itself cannot complete

### STREAM-007 — Comparability enrichment
For a validated `answer` whose trace shows successful `get_financials` calls for two or more companies with at least one audit-supported metric (revenue, operating income, net income; operating margin when revenue and operating income are fetched), the server runs the deterministic comparability audit (`lib/audit/research.ts`, no model call, bounded at 6 s) after the agent finishes and before the run is saved. The first company is the anchor; up to two pairs are audited. The audited fiscal year is the most recent FY the answer's tables or prose show that every audited company reports (`latest` only when none is shown), and multi-year research states that other years were not audited. The summary (`ResearchAuditSummary`) is saved as `runs.trace.audit` and sent as `audit {audit}` after `final`. It never changes `final`, the run's status or usage; an audit failure yields an `unavailable` summary or no event, never a failed run. Saved runs without `trace.audit` show no review.

### STREAM-006 — Provisional answer preview
`answer_delta {text}` carries the cumulative, UNVERIFIED prose of `final_answer.answer_markdown` as the model generates it (at most ~10 per second, extracted by `lib/agent/partialJson.ts` from the streamed tool input). It is display-only: never persisted, never counted, never trusted; citation markers are hidden in the client preview. The `final` event (server-resolved, citation-verified) is the single source of truth and replaces the preview; a run that ends in `error` discards it and saves a failed run. Clients that ignore `answer_delta` still work. If the streaming model call fails for any reason other than a user cancel, the loop retries once without streaming within the remaining time budget, so streaming can never break a request. `AGENT_STREAMING=off` disables it. Saved runs are never replayed as streams.

Tables, sources and follow-ups are previewed the same way with `answer_extras {tables, sources, followUps}` (cumulative). The server sends only what it already verified against this run's registry: a table row only when every figure in it matches data a tool returned (the same `figuresIn`/`ctx.figures` test the final check uses), a source only when its key was returned by a tool, and never a half-written row, citation or follow-up. Rows withheld here still appear in `final` with the usual note. The client reveals preview content at a readable pace and shows the validated answer only after the preview has finished (at most ~2.5 s later).

### STREAM-003 — No proxy buffering
Response headers should discourage buffering/caching so trace events appear live.

### STREAM-005 — Client disconnect
When the client disconnects, the agent run is aborted (no further model or tool calls) and saved once as `failed` with the trace so far.

### STREAM-004 — Persistence
After an agent run:
- save question
- save answer text
- save structured trace/answer object
- save status
- associate with user

A DB save failure is logged but does not suppress a valid answer that is ready to return.

---

## 8. Payment and Pro upgrade

### PAY-001 — Test mode only
Stripe runs in test mode for this capstone.

### PAY-002 — Price
Pro is a one-time **$19** upgrade.

### PAY-003 — Checkout auth
`POST /api/checkout` is available only to an authenticated user.

### PAY-004 — Already Pro
An already-Pro user is not sent through another upgrade checkout. The UI shows that they are already Pro.

### PAY-005 — User identity
The server places the authenticated Supabase user id into trusted Stripe session metadata. Do not accept an arbitrary client-supplied target user id for upgrade.

### PAY-006 — Webhook is authoritative
The Pro entitlement changes only when `/api/stripe/webhook`:
1. receives the relevant completed Checkout event
2. verifies the Stripe webhook signature
3. reads the server-created metadata
4. updates the matching Supabase profile

The success redirect alone does not grant Pro.

### PAY-007 — Idempotency
Receiving the same completed event more than once is safe. Setting the profile to `pro` repeatedly must not corrupt state.

### PAY-008 — Cancel path
Cancelling checkout returns the user to the app/pricing page. Plan remains unchanged.

---

## 9. Frontend

### UI-001 — Main ask flow
The user can:
- submit a question
- see trace steps as they stream
- see the final cited answer
- click follow-up questions to ask again

### UI-002 — Answer rendering
Structured tables render as HTML tables, not markdown-parsed table text.

### UI-003 — Source links
Citation markers link to a numbered source list. SEC sources link to the 10-K document itself on EDGAR (resolved from the SEC submissions API); if that lookup fails they fall back to the filing's EDGAR index page.

### UI-004 — Non-answer rendering
Non-answer kinds use a neutral information treatment rather than misleading table/source chrome. Exception: `insufficient_data` keeps any tables and sources the agent returned, so partial research is not discarded (UI rebuild spec, section 24).

### UI-007 — Clarification choices
For a `clarification` with options, the UI shows each option as a button (same style as the example questions) and a text box for typing the exact company name or ticker. Clicking asks the rewritten question; the text box substitutes the typed name for the ambiguous one.

### UI-005 — Plan usage state
The UI shows:
- plan
- remaining questions
- upgrade CTA when free usage is exhausted
- daily reset context when Pro limit is reached

### UI-006 — Error states
User-visible errors are actionable and human-readable. No raw stack traces or secret-bearing error bodies reach the browser.

---

## 10. Security and safety

### SEC-001 — Secrets
All provider and privileged database keys live in local/Railway environment variables, not source control.

### SEC-002 — Supabase RLS
Users can only read their own user-scoped data under the intended RLS policies. Plan escalation is not writable by the ordinary browser client.

### SEC-003 — Stripe signature
Webhook requests with an invalid signature are rejected and perform no plan update.

### SEC-004 — Prompt injection
Third-party text cannot override system/tool instructions. News content is explicitly represented as untrusted data.

### SEC-005 — Safe math
No dynamic JavaScript execution for calculations.

---

## 11. Observability and run evidence

### OBS-001 — Run record
Every attempted agent execution should leave enough evidence to inspect:
- question
- final answer
- status
- ordered trace
- creation time

### OBS-002 — Server logs
Unexpected provider, Stripe, Supabase, and tool failures are logged server-side with enough context to diagnose, but without secrets.

### OBS-003 — Demo metrics
Before final freeze, record wall-clock time for the selected demo questions on Sonnet/live deployment.

---

## 12. Quality gates

### QA-001 — Static
`npm run lint` and `npm run build` pass.

### QA-002 — Step 2 agent cases
All named Step 2 cases in `eval/cases.json` pass.

### QA-003 — Browser integration
Logged-in browser flow proves:
- NDJSON is parsed incrementally
- trace appears before final answer
- answer renders
- run persists in Supabase

### QA-004 — Sonnet verification
At least the primary benchmark and edge cases are re-run on Sonnet before the demo.

### QA-005 — Usage verification
Free and Pro boundary behavior matches PLAN-001 through PLAN-005.

### QA-006 — Stripe verification
On the live/test deployment:
- a test checkout completes
- verified webhook flips plan
- user can ask again immediately
- cancel path is safe

### QA-007 — No secret leakage
Diff and repository contain no secrets.

---

## 13. Demo success criteria

A final demo-ready build must prove:

1. New user can sign up/log in.
2. A three-company multi-year benchmark returns a correct cited answer.
3. Trace streams live.
4. Response completes in roughly the PRD's under-60-second target for the chosen demo query.
5. A named edge case returns a clean non-answer.
6. Free usage exhaustion produces an upgrade prompt.
7. Stripe test payment upgrades the account.
8. The upgraded user can ask again immediately.
9. No secrets are in the repo.
10. `BIG_AUDIT.md` has no unknown demo-blocking items.

---

## 14. Known capstone limitations

These are not release blockers unless the PRD changes:
- in-memory SEC cache resets on Railway restart and has no size limit (one parsed company-facts file is several MB; fine for a demo)
- no distributed request reservation for usage caps
- no general request rate limiter beyond product usage checks
- no production subscription lifecycle
- no monitoring/alerting platform
- no non-SEC data provider
- no real-time market data
