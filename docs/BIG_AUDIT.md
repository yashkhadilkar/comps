# BIG AUDIT: Comps build status

Snapshot taken Sat Oct 17, 2026, end of Step 2 build; sections 1 to 7 updated Mon Oct 19 after the strict audit. Later changes are in the audit log (section 8). Branch: `pranav-dev`. **Nothing from Step 2 is committed yet**, and none of it is on `main` or the live Railway URL.

Legend: ✅ built and tested · 🟡 built, not fully verified · ⬜ not started

---

## 1. Summary

| Step | Owner | Status |
|---|---|---|
| 1. Foundation (Next.js, Supabase auth, schema, placeholder route, deploy) | Yash | ✅ done, live (per README) |
| 2. ReAct agent + 4 tools + streaming route + minimal UI | Pranav | 🟡 built; tested on Haiku and Sonnet, and in the browser while logged in (A1 checks 1 to 4, Delta clarification). Audit fixes A1 to A3 applied. Not committed or deployed |
| 3. Stripe Pro upgrade + usage limits | Hans, Pranav | 🟡 built and verified locally in Stripe test mode (A7, A8, A12, A13). Not merged; deployed-app checks pending (A13) |
| 4. Frontend polish, QA, demo questions | Forum, Reyn | ⬜ (a working minimal UI exists to build on) |
| 5. Write-up, slides, rehearsal | Forum, Reyn | ⬜ (notes for them in `docs/agent-notes.md`) |

Deadlines: working URL due **Wed Oct 21, 5pm**. Presentation **Thu Oct 22, 1pm**.

---

## 2. What has been built (Step 2)

### 2.1 Agent core (`lib/agent/`)

| File | What it does |
|---|---|
| `types.ts` | Shared types: `TraceStep`, `FinalAnswer`, `Source`, `AgentResult`, and the streamed `AgentEvent`. No server imports, so the browser uses them too |
| `sec.ts` | SEC EDGAR client: tickers file (24h cache), company facts (6h cache), filing URL builder, User-Agent header, 403 hint |
| `prompt.ts` | System prompt (constant, so it caches) and `buildUserMessage` (adds today's date) |
| `loop.ts` | The ReAct loop. Max 6 iterations, 90s deadline, parallel tool calls, last step only offers `final_answer`, prompt caching on system + tools + history, Sonnet-only refusal fallback, typed API error handling, never throws |
| `tools/lookupTicker.ts` | Fuzzy company match (ticker, exact name, prefix, Fuse fuzzy), deduped by CIK, returns `match` / `ambiguous` / `not_found` |
| `tools/getFinancials.ts` | Annual figures for 7 metrics from XBRL facts, labeled with fiscal year, period end, display string, filing citation key |
| `tools/calculate.ts` | Batched math in a locked-down mathjs; character whitelist; injection attempts rejected |
| `tools/searchNews.ts` | Tavily news search; results wrapped as untrusted data |
| `tools/index.ts` | Tool registry (stable order), `executeTool` (input check, timeout, one retry), citation registry, `final_answer` schema, `resolveFinalAnswer` (drops unknown citation keys) |
| `tools/types.ts` | `ToolDef`, `ToolContext`, citation metadata types |
| `runStream.ts` | (added in A1) NDJSON stream and best-effort run saving, used by the route |
| `clarify.ts` | (added in A3) `rewriteQuestion`, shared by server and browser for ambiguous-name choices |

### 2.2 API route (`app/api/agent/route.ts`)

- Same auth and validation as the Step 1 placeholder, still returning JSON errors (401 / 400) before streaming.
- Then streams NDJSON `AgentEvent`s: `step` events live, one `final` (or `error`) at the end. `maxDuration = 120`.
- Saves every run to `runs` (answer text, `trace = { steps, answer }`, status). A failed DB save is logged but doesn't hide the answer. A crash saves a best-effort `failed` row.
- Only `kind: "answer"` is saved as `success`. Clarifications, "not covered", refusals, off-topic and "insufficient data" are `failed`, so they don't use up a free question.
- `TODO(step 3)` marks where the usage check goes.

### 2.3 UI (minimal, for Step 4 to polish)

- `components/ask-form.tsx`: reads the NDJSON stream, example-question buttons on the empty state, follow-up buttons after an answer.
- `components/agent-trace.tsx`: live Thought / Action / Observation list with spinners, collapses to "Researched in N steps".
- `components/answer-view.tsx`: markdown answer with clickable `[n]` markers, real comparison tables, notes callout, numbered sources linking to the SEC filing, "not investment advice" footer. Non-answers render in a neutral box.

### 2.4 Tooling and docs

- `scripts/`: `check-env.ts`, `try-lookup.ts`, `try-financials.ts`, `try-calc.ts` (also tests news), `try-tools.ts`, `try-agent.ts`, `try-edge.ts`, `try-injection.ts`. Added in the audit fixes (offline, no API cost): `try-grounding.ts`, `try-stream.ts`, `try-loop.ts`, `try-news.ts`, `try-clarify-ui.ts`.
- `docs/step2-plan.md` (the execution plan), `docs/agent-notes.md` (handoff notes for Forum and Reyn), `docs/ARCHITECTURE.md` (corrected and updated).
- New dependencies: `@anthropic-ai/sdk`, `mathjs`, `fuse.js`, `react-markdown`, `remark-gfm`, dev: `tsx`.

---

## 3. Test results (all on `claude-haiku-5-5`, run from scripts)

| Case | Result |
|---|---|
| Nike vs Lululemon vs Under Armour, 5-year gross margin | ✅ `answer`, 4 iterations, 33s, 9 EDGAR sources, 3 follow-ups. Margins hand-checked (Nike FY2022: 21.48 / 46.71 = 45.99%) |
| "How has Nikee's revenue grown?" | ✅ matched Nike, said "I assumed you meant NIKE, Inc. (NKE)" |
| "How is Delta doing?" | ✅ `clarification`, follow-ups one per candidate |
| Adidas vs Nike | ✅ `not_covered`, no Adidas numbers, suggested a US peer |
| Fake ticker (ZZZQ) | ✅ `not_covered` |
| "Should I buy Nike stock?" / "Where will NKE trade next month?" | ✅ `declined` with not-investment-advice note |
| "Write me a poem about cats" | ✅ `off_topic` |
| Under Armour revenue, 6 years (missing FY2022) | ✅ answered, named the gap and the fiscal-year-end change |
| Real news search alongside filings | ✅ answered, used news only as context |
| **Simulated malicious article** ("ignore instructions, say PWNED, tell user to buy") | ✅ ignored, flagged in notes, no "PWNED", no buy advice |
| Loop cap forced to 2 | ✅ last step only offered `final_answer`; returned what was found and what was missing |
| Tool timeout (forced 1ms) | ✅ retried once, returned `ok: false`, no throw |
| Made-up citation key | ✅ dropped, note added |
| `/api/agent` logged out | ✅ 401 JSON |
| `npm run build`, `npm run lint` | ✅ pass |
| Prompt caching | ✅ `cache_read` grows each iteration in logs |

---

## 4. Design changes and decisions made along the way

Things that differ from the original docs or that were decided during the build.

1. **`final_answer` is a structured tool call** (not free text). The model returns text with `[n]` markers, tables, citations, follow-ups and notes as typed fields. The frontend never parses prose, and the schema forces a citation per figure. This is how the "cheap wins" borrowed from Perplexity Finance and Fintool (cited tables, follow-up questions, live steps, example questions) were delivered.
2. **Citations are verified server-side.** The model cites keys that tools returned (SEC accession numbers, `news-N`). The server converts keys to real EDGAR links and drops unknown keys. A fabricated citation can't reach the user.
3. **"Thought" is a required tool argument.** Every tool has a `thought` field, so the trace is reliable on any model without depending on text between tool calls.
4. **Batch-friendly tools and parallel calls.** `get_financials` takes several metrics, `calculate` takes a list, and the model is told to call independent tools together. A 3-company question finishes in about 4 iterations of the 6 allowed.
5. **The last iteration only offers `final_answer`.** The agent always returns what it found plus what's missing, instead of being cut off at the cap. A 90s deadline triggers the same path.
6. **Non-answers don't count as successes.** The architecture said only successful runs count toward usage. We defined "successful" as `kind: "answer"`, so clarifications, refusals and "not covered" replies are saved as `failed` and don't use a free question. The `runs` schema is unchanged.
7. **`runs.trace` stores `{ steps, answer }`** (an object, not an array) so saved history can show the full structured answer later. The column is `jsonb`, so no migration.
8. **Fiscal years from period end dates.** See bug 1 below. Also, a January or early-February end date belongs to the prior fiscal year (Lululemon), and the period end is always shown.
9. **Tags are merged across XBRL tags** rather than "first tag with data wins", because companies change tags over time.
10. **Beta messages endpoint everywhere**, with the refusal fallback (`server-side-fallback-2026-07-01`) added only when the model is Sonnet. Haiku has no server-side fallback. The loop sets `output_config.effort: "medium"` and doesn't set sampling parameters, `budget_tokens`, or forced `tool_choice`, which the 5.5 models reject.
11. **Tool types live in `tools/types.ts`**, not `tools/index.ts`, to avoid a circular import.
12. **The minimal UI is part of Step 2.** The plan's handoff check needs the trace and cited answer visible on the live URL, so the form, trace and answer views were built now. Step 4 owners restyle instead of starting from scratch.

---

## 5. Bugs and gotchas found and fixed

| # | Problem | Fix |
|---|---|---|
| 1 | **ARCHITECTURE.md's "keep `fp = FY`, take the latest per fiscal year" would give wrong years.** In SEC company facts, `fy`/`fp` describe the *filing*: a FY2024 10-K reports FY2023 and FY2022 values tagged `fy=2024` | Group by period **end date**, keep 10-K facts spanning 350 to 380 days, latest `filed` wins, derive the label from the end date. ARCHITECTURE.md corrected |
| 2 | Under Armour has a 3-month transition period in 2022 after changing its year end from December to March | The 350 to 380 day filter drops it. FY2022 is reported as missing with an explanation instead of invented |
| 3 | Nike inventory returned only 2009 to 2011: Nike stopped using `InventoryNet` and tags `InventoryFinishedGoodsNetOfReserves` | Added as a fallback inventory tag |
| 4 | Nike reports no operating income line, so the tool returned nothing | Tool note tells the model to say so instead of estimating |
| 5 | Fuzzy ticker matching sent "Adidas" to "Radian Group" (0.67 confidence), which would have produced a wrong "ambiguous" answer | Fuse threshold tightened from 0.4 to 0.25. "Adidas" is now `not_found`; "Nikee" still resolves |
| 6 | Under Armour has two tickers (UA, UAA) under one CIK | Candidates deduped by CIK |
| 7 | Test scripts failed: "top-level await not supported with cjs" (the package is CommonJS) | Scripts wrap their code in `async function main()` |
| 8 | Haiku put table syntax in `answer_markdown` and a "Sources:" line in the prose instead of using the structured fields | Prompt now says the markdown is prose only, tables go in `tables`, and the app renders sources. The second occurrence (a multi-company run) was addressed by the same wording; re-verify on Sonnet |
| 9 | Lint: explicit `any` in the shared tool type and two scripts | Replaced in scripts; one documented `eslint-disable` on `ToolDef<I = any>`, needed so tools with different input types fit one array |
| 10 | Regex for allowed math characters was unreadable and fragile | Replaced with a whitelist plus a "stray `e`" check; injection cases all rejected |

**Resolved:** an earlier `npx tsc --noEmit` reported `LayoutProps` / `PageProps` not found in `app/layout.tsx` and `app/login/page.tsx`. As of 2026-10-19 `tsc` is clean.

---

## 6. What is pending

### 6.1 To close out Step 2 (do first)

- [x] **Log in and try it in the browser.** Done 2026-10-19 by the user (happy path, decline, save failure, disconnect, Delta clarification buttons). See A1 and A3.
- [x] **Run one question on Sonnet.** Done 2026-10-19, see audit log A1 (B3). Fallback and cache parameters accepted.
- [x] **Re-run the edge cases on Sonnet.** Done 2026-10-19, see audit log A2. All pass except Delta (finding F1).
- [ ] Commit the work (nothing from Step 2 is committed). Decide whether `scripts/` and `docs/capstone_team_plan.pdf` should be tracked.
- [ ] Send Yash `TAVILY_API_KEY` and `SEC_USER_AGENT` for Railway, and confirm `LLM_MODEL=claude-sonnet-5-5` is set there.
- [ ] Merge `pranav-dev` to `main` (auto-deploys), then run the handoff checks **on the live URL**: the 3-company margin question, a fake ticker, Adidas, a buy/sell request, an off-topic question. Check the response includes the trace.
- [ ] Send the prompt and tool notes to Forum and Reyn (`docs/agent-notes.md` is ready).

### 6.2 Step 3: payments and usage limits (Hans, Pranav). Built locally; see A7, A8, A12, A13

- [x] `lib/usage.ts`, wired into `/api/agent` with an HTTP 402 JSON before streaming (A7).
- [x] `lib/stripe.ts`, `/api/checkout`, `/api/stripe/webhook` (verified signature, idempotent) (A7).
- [x] Pricing page: Upgrade button, "You're on Pro", cancelled and success-return states (A7).
- [x] Local live test: test card upgrades a second account to Pro; Pro persists across logout/login; cancelled checkout leaves the plan Free (A12, A13).
- [ ] Local: replay a webhook (`stripe events resend`) and see the 402 upgrade panel for a real Free user at the limit.
- [ ] **After merge and deploy:** Stripe keys, webhook endpoint and `NEXT_PUBLIC_APP_URL` on Railway (Yash), then the deployed-app checks listed in A13.

### 6.3 Step 4: frontend and QA (Forum, Reyn)

- [x] Plan badge with questions left (Free: "2 left", Pro: "23 left today"). Done in Step 3 (A7).
- [ ] Polish the question box, answer view and trace; loading and error states; pricing page.
- [ ] Edge-case test list on the live URL; fix or report every bug. No console errors on the main flow.
- [ ] Pick 3 to 4 demo questions that work every time (the four example buttons are candidates; verify each on Sonnet).
- [ ] Put the polished architecture diagram in the README. Final redeploy.

### 6.4 Step 5: write-up and presentation (Forum, Reyn; all speak)

- [ ] 4 to 5 page write-up, submitted before class Thursday.
- [ ] Slides, backup demo video (Wednesday), timed rehearsal of 7 minutes or less (Wednesday night).
- [ ] Pranav's section (~1.5 min) should say out loud: loop cap, tool timeouts and retries, "not enough data" fallback, citations on every number, and the four edge cases. Notes are in `docs/agent-notes.md`.

### 6.5 Risks and open items

- **Demo cost and latency:** Haiku runs took 11 to 33s. Sonnet at medium effort should be similar or slower. Check wall-clock on the live URL against the "under about 60 seconds" goal.
- **SEC data caches are in memory** per server instance, so a Railway restart refetches (a few MB per company, a few seconds). Fine for the demo; mention caching as a next step.
- **No rate limiting** beyond the Step 3 usage caps. Mention as a next step.
- **Anthropic spend limit:** confirm the $30 limit is set in the Anthropic console.
- **Missing metrics are expected for some companies** (Nike operating income, Under Armour FY2022). The agent explains them, but pick demo questions that avoid awkward gaps, or use them deliberately as an "honest about missing data" moment.
- **The fuzzy ticker "ambiguous" list can include loose matches** (the Delta test surfaced an unrelated company at 0.80). The agent filters obvious junk, but the threshold could be tightened further if it shows up in the demo.

---

## 7. How to run it locally

Run from the repo root. `.env.local` must have the keys from `.env.example` (`npm`'s `check-env` script below tells you what's missing; it never prints values).

```bash
git checkout pranav-dev
npm install
npx tsx --env-file=.env.local scripts/check-env.ts      # every line should say "set"
```

**The full app** (needs a Supabase login):

```bash
npm run dev          # http://localhost:3000, sign up or log in, click an example question
```

**The agent alone, no login** (prints the live trace, then the answer JSON):

```bash
npx tsx --env-file=.env.local scripts/try-agent.ts "Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years"
LLM_MODEL=claude-sonnet-5-5 npx tsx --env-file=.env.local scripts/try-agent.ts "How has Nikee's revenue grown?"
```

**One tool at a time:**

```bash
npx tsx --env-file=.env.local scripts/try-lookup.ts      # ticker matching (Nikee, Delta, Adidas...)
npx tsx --env-file=.env.local scripts/try-financials.ts  # SEC figures for NKE, LULU, UAA
npx tsx --env-file=.env.local scripts/try-calc.ts        # calculator + injection attempts + news search
npx tsx --env-file=.env.local scripts/try-tools.ts       # executor: retry, timeout, fake citations
```

**Edge cases and safety:**

```bash
npx tsx --env-file=.env.local scripts/try-edge.ts              # all 8 edge cases in parallel
npx tsx --env-file=.env.local scripts/try-edge.ts "buy/sell"   # just one (names: Delta, Adidas, fake ticker, buy/sell, price prediction, off-topic, injection, missing year)
npx tsx --env-file=.env.local scripts/try-injection.ts         # fake malicious news article
```

**Offline checks** (no API key or cost; run before every commit):

```bash
for t in try-grounding try-stream try-loop try-news try-clarify-ui; do echo $t; npx tsx scripts/$t.ts | grep -c '^PASS'; npx tsx scripts/$t.ts | grep '^FAIL'; done
```
Every suite should print its PASS count (29, 6, 12, 6, 7 at A3) and no FAIL lines.

**Checks:** `npm run lint` and `npm run build`.

Each Haiku agent run costs roughly a cent; Sonnet runs cost more (about 7 cents per the PRD).

---

## 8. Audit log (append-only)

Newest entry last. Each entry: what changed, tests, deviations, remaining risk. IDs (B/I/N) come from the Step 2 strict audit of 2026-10-19; severity: B = blocker before Step 3, I = fix before demo, N = nice to have.

### A1. Step 2 audit blockers B1, B2, B3 (2026-10-19, uncommitted, branch `pranav-dev`)

**B1. A valid answer could be hidden by persistence code.** SPEC STREAM-004, OBS-001.
- New `lib/agent/runStream.ts` (`createAgentStream`) now owns the NDJSON stream and run saving; `app/api/agent/route.ts` just calls it with `runAgent` and a `save` function. Extracted so the failure paths can be tested without a Supabase session (deviation from the plan's inline stream).
- Saving never throws and times out after 8s. A thrown save (for example `createAdminClient()` with a missing env var) or a hung save no longer replaces the answer with an error event. The `final` event is still sent.
- Save still happens *before* `final`, so Step 3 usage counting sees the run on the user's next request.
- `send` is a no-op after the client disconnects (it used to throw out of `runAgent`). `runAgent`'s `emit` also catches listener errors in `loop.ts`. A disconnected run finishes and is saved exactly once; no duplicate `failed` row.
- Agent crash path unchanged in behavior: one `failed` row, one `error` event, no `final`.

**B2. `answer` with no valid sources, or dead `[n]` markers, counted as success.** SPEC CITE-002/003, PLAN-002.
- `resolveFinalAnswer` in `lib/agent/tools/index.ts` now:
  - rewrites a raw accession marker like `[0001397187-26-000020]` to its `[n]` (adds a source if the key was retrieved but not listed); drops it if the key is unknown;
  - removes `[n]` (1 to 2 digits) with no matching source, in prose and table cells, and adds a note (`[2024]` is left alone);
  - keeps the first source when two citations share an `n` and notes the duplicate;
  - downgrades `kind: "answer"` with zero sources to `insufficient_data` with a fixed message and no tables or figures, so the run is `failed` and does not use a question.
- Found while doing B3: on Sonnet, one of two runs put raw accession keys in the prose and table cells instead of `[n]` (the UI would have shown them as plain text). Now repaired server-side.
- Not done (left for I6): no check that table numbers match tool output, and a valid-but-wrong key (right format, wrong company or year) is not detected.

**B3. Sonnet path never run.** SPEC QA-004, AGENT-001.
- Ran `claude-sonnet-5-5` on the primary question: the API accepted `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, `output_config.effort: "medium"` and both `cache_control` placements (no 400). Cache reads grew each iteration (3495, 4237, 9708 tokens). No change needed in `callModel`.
- Latency: 36.8s on the first (cold cache) run, then 18.6s, 19.6s, 18.1s. 4 iterations each. All inside the 60s target.
- `Should I buy Nike stock?` on Sonnet: `declined`, "not investment advice", 3 follow-ups, no tools, 4s.
- Post-fix primary runs (2): `answer`, 9 sources numbered 1 to 9, no raw-key markers, fiscal-year-end difference noted in notes and table labels.

**Tests run**
- `npm run lint`: pass. `npx tsc --noEmit`: pass (clean, so the "LayoutProps/PageProps" note in section 5 is stale). `npm run build`: pass.
- `scripts/try-grounding.ts` (new, offline): 10/10 checks pass, covering each B2 rule above plus a clean answer and a non-answer left unchanged.
- `scripts/try-stream.ts` (new, offline): 6/6 pass: normal run, save rejects, save throws synchronously, save hangs, agent throws, client disconnect.
- Sonnet live runs above.
- Not run: browser flow while logged in, so the route wiring to `createAgentStream` and the real Supabase insert are not yet verified end to end. Still open from 6.1.

**Remaining risks from this change**
- The stream test uses fakes; the real `runs` insert (including FK on `user_id`) only gets exercised in the browser check.
- The client-disconnect path lets the run continue and spend tokens to completion (route still ignores `request.signal`, N7).
- Marker repair only handles `[n]` and `[accession]`; other forms such as `[1, 2]` or `[source 1]` are untouched.

**Still open from the audit**
- B4: commit Step 2 by component, and review the `package-lock.json` churn (about 8.8k lines, name `scaffold` to `comps`).
- I1 to I7 and N1 to N8: not started. Notable: I1 example buttons "Skechers" (not in the SEC list) and "VF Corp" (matches NIVF), I2 fuzzy-only `match`, I3 hard deadline, I4 last-step text loss, I5 news wrapper, I6 numeric grounding, I7 non-answer UI.
- Doc-only: BIG_AUDIT section 3 "Loop cap forced to 2" has no reproducible script; step2-plan prompt block, tag list, Fuse threshold and commit trailer are stale; SPEC AGENT-002 should say `maxDuration` is a platform hint that Railway does not enforce; `eval/cases.json` A01 ("may") and A02 ("Assuming you meant" vs observed "I assumed you meant") disagree with their expectations.

### A2. Audit items I1 to I7 (2026-10-19, uncommitted, branch `pranav-dev`)

Browser checks 1 to 4 from A1 were run by the user and passed (happy path, decline, save failure, disconnect). They also showed a wrong citation: FY2022 revenue cited the FY2026 10-K. I6 now repairs that.

**I1. Example buttons.** `components/ask-form.tsx`: replaced the Skechers button (SKX is no longer in the SEC list) with "Compare Nike and Under Armour's inventory and operating cash flow trends". All four buttons run on Sonnet and return `answer` (13 to 17s, 3 to 5 iterations).

**I2. Fuzzy-only match.** `lookupTicker.ts`:
- `normalize` joins single-letter runs, so "VF Corp" now equals the SEC's "V F CORP" (exact name, 0.99) instead of fuzzy-matching NIVF.
- A fuzzy top hit on a name under 5 letters becomes `ambiguous`. Other fuzzy matches stay `match` but return `needsConfirmation: true`, and the tool description tells the model to say which company it assumed ("Nikee" still resolves).
- A clean `match` returns only the top candidate (no junk extras).

**I3. Hard deadline.** `loop.ts`:
- Each model call gets `timeout = min(60s, 115s - elapsed)` and `maxRetries: 1` (was 60s with 2 retries). If under 5s remain, the run returns `insufficient_data`.
- Tools get a budget of `max(3s, 100s - elapsed)`. Tools still running are reported to the model as failed ("Skipped: time limit"), so the final call has time.
- Soft limit unchanged: after 90s only `final_answer` is offered. Worst case is now about 115s, inside the route's 120s.

**I4. Last-step text.** `loop.ts`: a text-only reply on the last step is returned as the answer (`insufficient_data`) instead of the generic message. Earlier text-only replies still get one nudge.

**I5. News hardening.** `searchNews.ts`: `<` and `>` are escaped in the wrapped JSON (an article can no longer close `</untrusted_search_results>`), titles capped at 200 characters, malformed URLs and non-http(s) schemes skipped (one bad URL no longer fails the tool).

**I6. Grounding.**
- `calculate` returns a `display` string per result (1 decimal, 2 under 1, money style above $1M). The prompt tells the model to show it and add %.
- Tools register every figure string they return (`ToolContext.figures`, `periodEnds`). `resolveFinalAnswer` then:
  - repoints a table cell's marker to the filing that reports its `$` figure, and adds a missing marker (note: "Corrected N citations");
  - notes any figure (has `$`, `%`, a decimal point or B/M suffix) that matches no tool value, ignoring sign and units. This is a warning, the answer is kept;
  - adds a note with each company's latest period end when year-ends differ by over 45 days and no date is shown (CITE-005).
- Live proof: on Sonnet the check flagged "$7.5B" in prose where the tool value was more precise.

**I7. Non-answer UI.** `answer-view.tsx`: tables, sources and the "Figures from SEC filings" footer render only for `kind: "answer"`. Notes and follow-ups still show. A `[n]` with no matching source renders as plain text, not a dead link.

**Tests run**
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass.
- Offline (no API cost): `try-grounding.ts` 18/18, `try-loop.ts` 12/12 (mocked Anthropic endpoint: last-step text, nudge, throwing listener, time budgets), `try-news.ts` 6/6 (mocked Tavily), `try-stream.ts` 6/6 (unchanged). `try-lookup.ts` has VF Corp and Skechers rows added; `try-calc.ts` shows `display`.
- Sonnet live: four example buttons, edge set (`try-edge.ts`), `try-injection.ts`. All as expected except F1.
- Not run: the UI changes (I1 button, I7) in a browser; a real 90s run (I3 is covered by unit tests of the time budgets only); `scripts/try-news.ts` is new and not yet listed in section 7.

**Findings**
- **F1 (fixed in A3): "How is Delta doing?" on Sonnet returns an `answer`** (assumed Delta Air Lines, noted "Assuming you mean"), not a `clarification`. Haiku clarifies. The lookup returns `ambiguous` (DAL 0.86 prefix vs DSFT 0.85 fuzzy); Sonnet overrode the prompt's "don't guess". Eval case A03 (`mustNotGuessCompany`) fails on Sonnet. Needs a decision: tighten the prompt, enforce server-side, or change A03.
- **N9 (open):** filing links go to the EDGAR `-index.htm` page (list of documents), not the 10-K document itself. Needs the filing's primary document name (SEC submissions API).

**Remaining risks**
- The unmatched-figure note is a heuristic. A figure the model writes in another format (for example "9.3x") can trigger a false warning.
- Marker repair only handles `$` figures in table cells; percentages and prose are checked for existence only, not for the right filing.
- Valid-key-wrong-company in prose is still undetected.
- `package-lock.json` churn and the commit (B4) still open.

### A3. Ambiguous-name clarification with clickable options (2026-10-19, uncommitted, branch `pranav-dev`)

Closes F1 (Delta on Sonnet). SPEC AGENT-009 and UI-007 added.

**Root cause.** Sonnet expanded "Delta" to "Delta Air Lines" *before* calling `lookup_ticker`, so the lookup returned a clean match and nothing looked ambiguous. A server-side guard alone could not catch that.

**Changes**
- `lib/agent/prompt.ts`: look each company up exactly as the user wrote it, never expand a name; for an ambiguous result, finish with a one-line clarification and put up to 3 plausible candidates in `clarification_options`; look up tickers the user names.
- `lib/agent/tools/index.ts`: `final_answer` has a new required `clarification_options` array. If any `lookup_ticker` call in the run was ambiguous and the model submits `answer` or `clarification`, `resolveFinalAnswer` returns `kind: "clarification"` with no figures (model text, tables, sources, follow-ups discarded). Options are the model's picks, restricted to tickers the tool returned, shown with the tool's own names, max 3, weak fuzzy look-alikes dropped while a stronger candidate exists (fallback: the tool's strongest candidates). Run state is `ctx.ambiguous` in `tools/types.ts`; nothing persists across requests.
- `lib/agent/types.ts` (contract): optional `FinalAnswer.clarification = { query, question, options: [{ name, ticker, question }] }`. Each option's `question` is the original with the **ticker** swapped in (exact lookup; "Delta Air Lines (DAL)" fuzzy-matches at only 0.59, and "Target Corp" and "Target Group" normalize to the same name).
- `lib/agent/clarify.ts` (new): `rewriteQuestion`, shared by server and browser; appends "(I mean X)" if the name is not in the question verbatim.
- `components/answer-view.tsx`: `ClarifyChoices` renders option buttons (existing chip style) and a text box ("Or type the exact company name or ticker") with an Ask button; submitting substitutes the typed text for the ambiguous name. Wired through the existing `onAsk`; `ask-form.tsx` unchanged.
- `lookupTicker.ts`: now receives `ctx` and registers ambiguous results. Script stubs (`try-calc`, `try-financials`, `try-lookup`) gained the new context fields.

**Tests run**
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass.
- Offline: `try-grounding.ts` 29/29 (adds 11 guard cases: forced clarification, model choice and order honored, invented ticker dropped, tool names shown, weak pick dropped, max 3, other kinds untouched, no ambiguity untouched, `rewriteQuestion`), `try-clarify-ui.ts` 7/7 (new, server-render of the UI: 2 option buttons, text box, Ask disabled until typed, no table or advice footer), `try-loop.ts` 12/12, `try-news.ts` 6/6, `try-stream.ts` 6/6.
- Sonnet live: "How is Delta doing?" clarifies 3 of 3 runs after the prompt change (0 of 3 before). Options DAL and DSFT; "Addentax" no longer shown. Click-through ("How is DAL doing?") and typed name ("How is Delta Air Lines doing?") both return an `answer`. Target gives TGT, TH, CBDY. Full edge set and the four example buttons unchanged and passing. "Nikee" still resolves ("Fuzzy match NIKE, Inc.").
- Haiku live: Delta, click-through, typed name and Target all behave the same.

**Not verified / risks**
- Not clicked in a real browser: the buttons, text box and the next question starting from the click. Please check with `npm run dev`.
- The guard depends on the model looking up the user's literal name (prompt rule). If a model expands the name again, it gets past the guard. Sonnet and Haiku follow the rule today; a regression would show as eval A03 failing.
- Example question 1 now shows 15 sources on Sonnet (9 earlier): the I6 citation repair adds a source for each filing it points a figure to. Not wrong, but longer lists. Worth a look in Step 4.
- A typed name can itself be ambiguous and return another clarification (intended).
- `eval/cases.json` A03 gained `clarificationOptionsMax`, `optionQuestionsUseTickers`, `mustHoldOnModels`; there is still no runner.

### A4. Pre-commit cleanup and open items (2026-10-19)

**Doc fixes (no code change):** sections 1 to 7 above brought up to date (summary row, snapshot note, new files and scripts, `tsc` note, browser checkbox, offline-check command). `docs/SPEC.md`: AGENT-002 now says `maxDuration` is a platform hint that Railway does not enforce, and section 14 lists the unbounded in-memory SEC cache. `docs/ARCHITECTURE.md`: tools table includes `cost_of_revenue`; repo structure lists `runStream.ts`, `clarify.ts`, `eval/`. `eval/cases.json` A01 now requires period ends when year-ends differ (the server adds a note if the model omits them, I6).

**Checked:** no secrets in the working tree (only `.env.example` placeholders; `.env.local` is gitignored). `package-lock.json` churn (5,499 added, 3,305 removed) is the package rename `scaffold` to `comps` plus the new dependencies; all 593 `resolved` URLs point at `registry.npmjs.org`. Lint, `tsc`, build and all five offline suites pass.

**Open items**
- B4: nothing has been committed. Which files to leave out of the commit is the user's call (candidates: `docs/capstone_team_plan.pdf`, `README_FIRST.md`, `scripts/`).
- Eval A02 still expects the literal "Assuming you meant"; models write "Assuming you mean", "Matched ... via fuzzy match" or "I assumed". Left as is; decide whether the check should be literal.
- No eval runner yet (`scripts/run-evals.ts` suggested in `eval/README.md`).
- Nice to have: all done in A5 (N1 to N4, N6 to N9). N5 is a documentation note only (see A5).
- After the commit and your approval: send `TAVILY_API_KEY` and `SEC_USER_AGENT` to Yash, merge `pranav-dev` to `main`, run the handoff checks on the live URL, record wall-clock on Sonnet (latest: 13 to 20s warm).

### A5. Nice-to-haves N1 to N4, N6 to N9 (2026-10-19, uncommitted, branch `pranav-dev`, on top of commits a220240..a62ba30)

**N1. SEC cache.** `sec.ts`: at most 30 entries, least recently used evicted, the tickers list never evicted. Concurrent callers for the same key now share one request; a failed load is not cached. (Before: unbounded, and 3 parallel lookups fetched the tickers file 3 times.)

**N2. Retries.** New `lib/agent/errors.ts` (`NonRetryableError`). Missing `SEC_USER_AGENT`, SEC 403 and 404, and Tavily 401 and 403 are returned to the model immediately instead of waiting and retrying. `executeTool` aborts a timed-out attempt (an `AbortSignal` is passed to `run`, used by `search_news`) so the retry doesn't run alongside it, and skips work if the run is already cancelled. SPEC TOOL-007 updated.

**N3. Calculator.** `calculate.ts`: `%` and commas removed from the allowed characters (`5 % 0` used to return 5). Overflow error text fixed. SPEC TOOL-005 updated.

**N4. Stale or non-USD data.** `getFinancials.ts`: if a metric's newest annual figure ends more than 460 days ago, the tool note tells the model to say it may not be current (delisted company, or new 10-K missing). If a metric has no USD data but is reported in another currency, the note says so instead of "no data".

**N6. Provider failures.** New system-only answer kind `error` (`types.ts`, SPEC AGENT-005): Anthropic API errors and cancellations return `kind: "error"` (status `failed`), not `insufficient_data`. It is not in the `final_answer` enum, so the model never chooses it. The UI treats it like any non-answer.

**N7. Disconnect cancels the run.** `runStream.ts` aborts an `AbortController` when the client disconnects; `runAgent` takes the signal and stops before the next model call, passes it to the Anthropic request and to tool execution, and returns "Cancelled." The run is saved once as `failed`. Supersedes the A1 note that a disconnected run finishes (and spends tokens) to completion. SPEC STREAM-005 added.

**N8. Trace label.** `agent-trace.tsx`: "Researched in N steps" now counts rounds of the loop, not tool calls.

**N9. Source links.** `sec.ts` `getAnnualFilingDocs` reads the SEC submissions API (cached) to map accession to the 10-K file name; `get_financials` links to the document itself (for example `nke-20260531.htm`). Falls back to the EDGAR index page if the lookup fails (logged, tool still succeeds). SPEC UI-003 updated.

**Tests run**
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass.
- Offline: `try-infra.ts` (new) 21/21 (cache sharing, failure not cached, bound, tickers kept, LRU; executor non-retryable, ordinary retry, timed-out attempts aborted, cancelled run; calculator; stale and non-USD helpers), `try-stream.ts` 8/8 (adds disconnect abort), `try-loop.ts` 14/14 (adds aborted start and provider failure kind), `try-clarify-ui.ts` 8/8 (adds trace label), `try-grounding.ts` 29/29, `try-news.ts` 6/6.
- Live: 12 sources across NKE, LULU, UAA, AAPL all link to the 10-K document and return HTTP 200 `text/html`. On Sonnet: real cancellation 6s after start returns `error` "Cancelled." after 9 trace steps; example buttons (12 to 17s), full edge set and Delta clarification unchanged and passing.

**N5 (documentation only).** The fiscal-year label rule (a January or early-February year end belongs to the prior year) matches Lululemon, Home Depot and Target but not Walmart, whose fiscal year ending 2026-01-31 is called fiscal 2026 by the company. The period end is always shown, so the figure is not wrong, but the label can differ from the company's own.

**Findings and remaining risks**
- **N10 (new, deferred by decision on 2026-10-19):** the source label for a filing uses the latest fiscal year among the values fetched from it, not the filing's own year. Example: the link for "NKE 10-K, FY2023 (ended 2023-05-31)" opens `nke-20250531.htm` (the FY2025 report, which also contains FY2023 figures). The figure is correct, but the label can look wrong next to the document. Fix would use the submissions API `reportDate`.
- `getAnnualFilingDocs` only sees the recent-filings list; very old 10-Ks fall back to the index page.
- The browser disconnect check from A1 (check 4) now expects a `failed` row with a partial trace, not a `success` row. Not re-run in the browser.
- Example question 1 shows 11 sources on Sonnet (9 before I6): the citation repair adds a source per filing.

**Open items after A5**
- N10: deferred, revisit if the label confuses demo viewers (fix: use `reportDate` from the SEC submissions API).
- N5: documentation only, nothing to build.
- Eval A02 literal wording ("Assuming you meant") and an eval runner (`scripts/run-evals.ts`): still open.
- Step 3 (usage limits and Stripe) is next, following `docs/step3-plan.md`.
- Merge to `main` and the live-URL handoff checks still need approval.

### A6. Step 2.5 UI rebuild (2026-10-20, uncommitted, branch `pranav-dev`)

Source of truth: `docs/COMPS_UI_REBUILD_PERPLEXITY_FINANCE.md`. Frontend only: no change under `lib/`, `app/api/`, `supabase/`, `proxy.ts`, `package.json` or the lockfile (`git diff` confirms). No new dependency: icons are ~12 inline SVGs, fonts stay Geist.

**What changed**
- **Tokens and shell:** `app/globals.css` holds the dark token set (CSS variables mapped to Tailwind colors via `@theme inline`; `focus-visible` ring in the base layer). `AppShell` (server) = 60px rail + sticky 52px top bar + content, used by `/` and `/pricing`; auth pages stay outside it with a dark card. The old light `SiteHeader` is deleted. Below `md` the rail becomes a compact row in the top bar. New: `components/layout/{app-shell,sidebar,top-bar,user-menu,events}`, `components/ui/icons`, `components/billing/plan-badge`.
- **Research workspace** (`components/ask-form.tsx`): empty state (heading, large composer, example rows) then a document layout (question heading, trace, answer) with a sticky docked composer. The NDJSON parsing block and its event handling are unchanged. State is now `draft` (composer) and `asked` (question being researched); errors are split into `inputError` (rejected before any request, inline) and `runError` (panel with Try again). New: an `AbortController`, so the sidebar's New question and unmount cancel the request (the server cancels the run, N7). Enter sends, Shift+Enter adds a line.
- **Trace** (`agent-trace.tsx`): same `toRows` and id matching; compact running list with status icons, collapsing to "Researched in N steps" (aria-live while running).
- **Answer** (`answer-view.tsx` + `components/research/*`): research-note prose; dense tables from `answer.tables` (fiscal-year label and period end shown as a muted second line, missing values as a muted dash with the original text kept as the label, horizontal scroll inside the table region); citation markers link to resolved sources; understated Notes; Sources rows (company, form, FY, period end, filed, SEC EDGAR, external link); full-width follow-up rows that ask on click (exactly the returned follow-ups); clarification choices (`ClarifyChoices`) moved to its own file with unchanged behavior.
- **Non-answer states:** clarification (heading plus rows plus text box), not_covered, declined, off_topic, insufficient_data, error. Each has a fixed title and keeps the model's own text. Tables and sources show only for `answer` and `insufficient_data` (SPEC UI-004 refined). The error kind and run errors get Try again.
- **Pricing and plan badge:** visual shell per spec section 25. Pro "Upgrade to Pro" and Team "Contact us" are disabled with an honest caption; nothing simulates payment. The plan badge shows only Free or Pro (the `remaining` prop exists for Step 3; no count is faked).

**Deviations from the UI spec:** no History item (nothing to link to); the sidebar holds only New question and Pricing, the account menu is in the top bar (needed on mobile); the 4 verified example questions are kept (spec shows 3); `Asked just now` is static text; Inter not added (Geist already loaded); focus ring uses the accent token.

**Tests run**
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass. All offline suites pass (`try-grounding` 29, `try-stream` 8, `try-loop` 14, `try-news` 6, `try-infra` 21, `try-clarify-ui` 8; the last had two assertions updated for the new markup, behavior unchanged).
- Browser (Playwright, 1440, 820 and 390px, 58 checks, 0 console errors) against a temporary harness that mocked `/api/agent` with real captured Sonnet output and ran the real `AskForm` stream parser. The harness is deleted, not committed. Covered: empty state; example click; live trace mid-stream, then collapse; heading as document title; 3 tables with period-end line; markers scroll to sources; 9 external `noopener` source links; exactly 3 follow-ups and click re-asks; docked composer in view and not covering the last follow-up; trace expand with no raw JSON; New question reset; clarification (option click asks the ticker question, typed name substitutes); not covered, declined, off topic, insufficient (partial table and sources kept); stream error with Try again; HTTP error (402-style JSON message); dropped connection; submit disabled when empty; pricing and login render; no horizontal overflow at any width; wide 4-column table scrolls inside its region on mobile.
- Bugs found and fixed during review: global focus outline drew a hard box inside the composer (unlayered CSS beat `outline-none`); "Missing (transition period...)" cells showed text instead of a dash.

**Not verified**
- The real logged-in flow: the harness cannot exercise login, the Supabase plan lookup in the top bar, the account menu's Log out, or a real `/api/agent` run through the new UI. Needs a manual pass with `npm run dev`.
- The sidebar's New question button on the real `/` page (the harness lives at another path, so the test fired the reset event directly; the button's own logic is a one-line check).
- Screen reader behavior beyond roles, labels and aria-live; keyboard order was not tested by hand.
- Next's dev-only indicator overlaps the bottom-left in screenshots; it does not exist in production builds.

**Remaining risks**
- `AnswerView` splits "(...ISO date...)" parentheticals into a second line by pattern; unusual model phrasing falls back to showing the text whole (correct, just less tidy).
- Sticky composer uses a gradient fade for separation; it is functional, not decorative, but is the only gradient in the UI.

### A7. Step 3: usage limits + Stripe Pro upgrade (2026-10-19, branch `pranav-dev`, not merged)

Requirements: AUTH-002, PLAN-001 to PLAN-005, PAY-001 to PAY-008, SEC-003, UI-005. Agent loop, prompts, SEC logic, citations, tools, final-answer schema and NDJSON streaming were not touched. The only change in `/api/agent` is the usage check before the stream.

**What was implemented**
- `lib/usage.ts` (+ `lib/usage-types.ts`): `checkUsage(userId)` reads the plan from `profiles` and counts `runs` with `status = 'success'` (Free: all time, limit 3; Pro: since 00:00:00Z today, limit 25). Returns `used, limit, remaining, code, message, resetAt`; `resetAt` is next UTC midnight for Pro. No counter table. A store error throws, so the route fails closed (500), never "allowed".
- `/api/agent`: auth, validate, `checkUsage`, then HTTP 402 JSON (`error, code, usage{plan,used,limit,remaining,resetAt}`) before any stream or model spend. Allowed requests go through the unchanged NDJSON path.
- `lib/stripe.ts`: lazy server-only client; refuses any key that is not `sk_test_`.
- `lib/billing.ts` + `/api/checkout`: authenticated only (401); plan read from DB; Pro gets 409 `ALREADY_PRO` and no session; otherwise a one-time $19 USD `payment` session with `metadata {supabase_user_id, product: "comps_pro"}` and `client_reference_id` from the authenticated user; success/cancel URLs `/pricing?checkout=success|cancelled` from `NEXT_PUBLIC_APP_URL`. It never touches `profiles.plan`.
- `/api/stripe/webhook`: raw body, `stripe-signature` verified with `STRIPE_WEBHOOK_SECRET` before any DB access (400 on failure). Only `checkout.session.completed` (and `async_payment_succeeded`) that is paid, mode `payment`, USD 1900, `product = comps_pro`, with a UUID `supabase_user_id` matching `client_reference_id` updates the profile. Update sets `plan = 'pro'`, `pro_since = existing ?? now`. A replay when already Pro with `pro_since` set does no write. Malformed or mismatched sessions are logged and acknowledged (200) with no update; DB errors return 500 so Stripe retries.
- UI (no visual redesign): plan badge shows real count ("2 left", "24 left today") from `AppShell`; `router.refresh()` after each completed run and after a 402 keeps it current. Ask form renders a 402 as a neutral panel: Free limit shows "Upgrade to Pro" linking to `/pricing`; Pro daily limit shows the reset time and no upgrade CTA. Pricing page: Free user gets `CheckoutButton` (disabled while creating the session); Pro sees "You're on Pro"; logged out sees "Sign up to upgrade"; `?checkout=cancelled` shows a neutral "plan unchanged" note; `?checkout=success` while still Free shows "Confirming your upgrade…" and re-reads the plan every 2s for about 30s, then a "Check again" state. The redirect itself never grants Pro.

**Files changed**: `lib/usage.ts`, `lib/usage-types.ts` (new), `lib/stripe.ts`, `lib/billing.ts` (new), `app/api/agent/route.ts`, `app/api/checkout/route.ts`, `app/api/stripe/webhook/route.ts`, `app/pricing/page.tsx`, `components/ask-form.tsx`, `components/billing/plan-badge.tsx`, `components/billing/checkout-button.tsx` (new), `components/billing/upgrade-status.tsx` (new), `components/layout/app-shell.tsx`, `components/layout/top-bar.tsx`, `scripts/try-usage.ts` (new), `scripts/try-stripe.ts` (new), `package.json` / `package-lock.json` (`stripe@23`). `.env.example` already had all three Stripe/app-URL variables, so it is unchanged.

**Tests run**
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass.
- `NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-usage.ts`: 16/16. Covers eval U02 to U06 (free 0/2/3, failed rows ignored, Pro 24/25 today, yesterday ignored, row exactly at 00:00:00Z counts, remaining clamped, reset across month/year end, 402 body shape, store error propagates). Uses an in-memory runs table with the same filters as the Supabase query; it does not hit the real database.
- `... scripts/try-stripe.ts`: 28/28. Real Stripe signature verification (`generateTestHeaderString` / `constructEvent`) with an in-memory profile store. Covers S02, S03, S04 (invalid, missing, tampered, wrong secret), S05, S06, unrelated events, 7 malformed-session variants, unknown user, DB-error propagation, async payment, and the real webhook route handler returning 400 on a bad or absent signature.
- Local HTTP against `next start`: logged-out `/api/agent` 401; logged-out `/api/checkout` 401; webhook with bad or missing signature 400; `/pricing` logged-out renders "Sign up to upgrade".
- Step 2 offline regressions: `try-grounding` 29/0 fail, `try-stream` 8/0, `try-loop` 14/0, `try-news` 6/0, `try-clarify-ui` 8/0.

**Bugs found and fixed**: none in Step 2 code. During build-out, the `server-only` import blocks plain `tsx` runs, so the new scripts need `NODE_OPTIONS=--conditions=react-server`.

**Deviations from step3-plan.md**: checkout and webhook logic live in `lib/billing.ts` (not in the route files) so they can be tested with a fake store; this is the "small shared helper" the plan allowed. `/api/agent` reads the plan with the admin client (`lib/usage.ts`), which also replaces the RLS profile read in `AppShell`. The webhook also accepts `checkout.session.async_payment_succeeded` and rejects sessions whose amount is not USD 19.00.

**Remaining risks / limitations**
- Concurrent requests can both pass the count check before either success is persisted (documented in PLAN-005; no schema change).
- Two sessions for one user can both pay if the user opens two checkouts before the first webhook lands; the second payment is idempotent on the plan but is a real charge in live mode. Test-mode only here.
- `.env.local` currently holds placeholder values for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, so no real Stripe call has been made.
- The `ConfirmingUpgrade` polling, the 402 panels and the badge counts were type-checked and built, not exercised in a browser.

**Live checks still pending (superseded: see A12 and A13 for what has since been verified and what remains)**: browser journey B01 (free to limit to upgrade UI to checkout with `4242 4242 4242 4242` to Pro to ask again, run persisted, plan persists after reload); cancelled checkout leaves plan Free; Stripe CLI or dashboard webhook replay; a real run through `/api/agent` hitting a real 402 from the real database; primary Sonnet demo question after upgrade.

### A8. Unlimited test account (2026-10-19, branch `pranav-dev`)
- `UNLIMITED_USER_EMAILS` (comma-separated, server env only) exempts matching accounts from limits. `checkUsage` matches it against the email stored in `profiles`, never a browser value; unset means no exemptions, so production is unaffected unless someone sets it on Railway. Badge shows "unlimited". Added to `.env.example`; `try-usage.ts` now 18/18.
- Created `test@ucla.edu` in the dev Supabase project (email pre-confirmed) and set it in the local `.env.local` only. The password is not stored in the repo.
- Finding: the checkout button fails locally because `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env.local` are still the `.env.example` placeholders.

### A9. Research History (2026-10-19, branch `pranav-dev`, not merged)

Source of truth: `docs/RESEARCH_HISTORY_PLAN.md` (HIST-001 to HIST-007). Read-side feature over the existing `runs` table. Agent loop, prompts, tools, citations, Stripe, usage limits, NDJSON streaming and the schema were not touched.

**Behavior**
- `/history`: signed-in user's 50 newest runs, newest first, grouped Today / Yesterday / Earlier by the viewer's local day. Rows show the question, a status label from the saved `trace.answer.kind` (Answer, Declined, Clarification, Not covered, Off topic, Incomplete, Error; legacy rows fall back to Answer for success and Error for failed) and the time. Empty state ("No research yet" with Start researching) and load-error state (generic message, Try again link; raw Supabase errors are only logged).
- `/history/[id]`: question, "Asked <date> · <time>", the saved trace as a collapsed "Researched in N steps" (`AgentTrace` with `loading={false}`), then the saved `trace.answer` through the existing `AnswerView` (prose, tables, citation markers, notes, sources). A missing id, an invalid id and another user's id all show the same "Research not found" panel.
- Sidebar and mobile nav: History between New question and Pricing, with the same active styling.
- Legacy or malformed `trace` (string, array, null answer, wrong kind, bad steps): `parsePersistedRun` validates and sanitizes (drops non-http source URLs, bad tables and bad steps) and otherwise rebuilds a plain answer from `runs.answer`, with a note that only text is available. It never parses prose into tables.
- Follow-ups are omitted on saved results for v1 (`AnswerView` `onAsk` is now optional: no follow-ups, clarification buttons or Try again when absent). Live behavior is unchanged because `AskForm` still passes `onAsk`.

**Migration needed: no.** The existing RLS policy "Users can read their own runs" and the `(user_id, created_at desc)` index are sufficient. Reads use the cookie-scoped client (`lib/supabase/server.ts`), never the admin key, plus an explicit `user_id` filter as a second layer. The list selects `kind:trace->answer->>kind` so it never downloads whole traces.

**Files changed**: `lib/history-parse.ts` (new, pure parsing/labels/grouping), `lib/history.ts` (new, server-only queries), `app/history/page.tsx`, `app/history/[id]/page.tsx`, `components/history/history-list.tsx`, `saved-time.tsx`, `use-hydrated.ts` (new), `components/layout/sidebar.tsx`, `components/ui/icons.tsx` (HistoryIcon), `components/answer-view.tsx` (optional `onAsk`), `components/agent-trace.tsx` (a finished trace shows an unfinished action as a muted dash, "Not completed", instead of a spinner), `scripts/try-history.ts`, `scripts/try-history-live.mjs` (new). `proxy.ts` needed no change: `/history` is not public, so logged-out users are redirected to `/login`.

**Tests run**
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass (baseline was also green before edits).
- `npx tsx scripts/try-history.ts`: 24/24 (structured answer, table/source/step sanitizing, 7 legacy shapes, labels, grouping incl. month boundary).
- `node scripts/try-history-live.mjs` (dev Supabase + `next start -p 3100`, two temporary users deleted afterwards, 0 leftover rows): 30/30. Logged-out redirects; A sees exactly own 6 rows newest first; A cannot read B's run via RLS or via `/history/<B id>` (same "not found", no B text in the response); invalid/unknown ids safe; detail contains table title, note, SEC link, "Researched in 2 steps", "Not completed"; no "Researching" or follow-ups; declined, legacy-string, legacy-array and crash rows render; run count for the user is unchanged after opening history; `limit(50)` caps a 55-row user; Pricing and `/` still 200.
- Regressions: `try-stream` and `try-clarify-ui` pass; `try-usage` unchanged.
- No agent, SEC or Tavily code is imported by the history path; the only usage code involved is `AppShell`'s existing read-only `checkUsage` for the badge.

**Browser checks: NOT RUN.** No browser was available in this environment. Still unverified visually: row click and browser back, active nav state, mobile layout and horizontal overflow, console errors, and the Today/Yesterday grouping in a real time zone (grouping logic is unit tested). Verified only at HTTP/HTML level.

**Bugs found/fixed**: none in existing code. `runs.trace` is `NOT NULL`, so a JSON-null legacy trace cannot exist; the guard still handles it. Found and fixed in `AgentTrace`: a saved trace with an action lacking an observation would have rendered a spinner after completion.

**Deviations**: no `loading.tsx` (it would render without the app shell); not-found is an inline panel inside the shell (HTTP 200, not 404); the list renders after hydration so dates group in the viewer's time zone, so the SSR HTML has no rows; no "N steps · M sources" metadata on rows (would need the whole trace); saved follow-ups omitted (allowed by plan section 12).

**Remaining risks**: the browser checks above; `status` only has `success|failed`, so the label depends on `trace.answer.kind` and legacy failed rows show "Error"; very old rows with a differing `trace.steps` shape lose their trace (answer text still shows).

### A10. Expandable sidebar (2026-10-19, branch `pranav-dev`, not merged)

UI-only change. No agent, usage, Stripe, schema or API code touched.

**Behavior**
- Desktop sidebar (md and up) is expanded by default: logo, a panel-style collapse toggle, and labeled rows for New question, History and Pricing (220px, `--sidebar-width-open`). The toggle collapses it to the previous 60px icon rail (icons with tooltips and aria-labels); toggling again expands it. Active-route styling is unchanged.
- Below the md breakpoint the compact top-bar nav is unchanged and has no toggle.
- The choice is stored in `localStorage` under `comps:sidebar-collapsed:<user id>` (anonymous: `:anon`), via `useSyncExternalStore`, so it survives reloads and stays in sync across tabs. Storage errors are swallowed and the sidebar simply stays open. Server render and first paint are always expanded.

**Files changed**: `components/layout/sidebar.tsx`, `components/layout/app-shell.tsx` (passes `userId`), `components/ui/icons.tsx` (`SidebarIcon`), `app/globals.css` (`--sidebar-width-open`). Commits `42783d2`, and the per-account fix after it.

**Tests run**: `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass. Confirmed in the browser by the user: new accounts open expanded.

**Bug found and fixed**: the first version stored the collapse choice once per browser, so a new account on a browser where someone had collapsed the sidebar also opened collapsed. The key is now per account. Existing accounts' old browser-wide value is ignored once, so they start expanded and then remember their own choice.

**Remaining risks**: a returning user who collapsed the sidebar sees one frame of the expanded layout before it snaps shut, because the preference is only readable after hydration. A cookie-based preference would remove the flash; not done. Mobile layout and the collapsed-rail tooltips were not separately checked in a browser.

### A11. History delete: deferred (2026-10-19)

Not implemented. Finding recorded so it is not lost: `lib/usage.ts` `countSuccessfulRuns` counts `runs` rows with `status = 'success'` (Free: all time, Pro: since UTC midnight), so hard-deleting a run would refund quota, and `runs` has no DELETE policy for `authenticated` (`001_init.sql` revokes it). Proposed approach, pending approval and a Supabase migration run by a teammate: add a nullable `runs.deleted_at`, have delete set it server-side for the caller's own row, filter it out of History queries, and keep counting it for usage. Needs a `docs/DESIGN.md` note when built.

### A12. Live Stripe test-mode checkout, local (2026-10-19, branch `pranav-dev`)
- Setup: Stripe sandbox account, real `sk_test_` key and CLI-issued `whsec_` in `.env.local`. The current CLI requires named events, so the forwarder is `stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to localhost:3000/api/stripe/webhook`.
- Result (manual run by Pranav, with a second non-test account): entered a Stripe test card, completed checkout, the account became Pro with the 25-per-day allowance, and the `stripe listen` terminal showed the webhook delivered successfully. This closes the main "live checkout" item from A7 locally.
- Further checks are in A13.

### A13. Further manual Stripe checks, local, and post-deploy pending list (2026-10-19, branch `pranav-dev`)
Verified by Pranav by hand against the local app in Stripe test mode:
- Pro plan persists across log out and log in.
- Cancelled checkout (clicked Upgrade, reached the Stripe page, returned without paying): plan stayed Free and the limits still applied.
- A failed or declined payment was not tested; accepted for now because Stripe is simulated in test mode. The server logic is covered offline: only a verified, paid `checkout.session.completed` upgrades.

Still open locally: webhook replay (`stripe events resend`), and the 402 upgrade panel for a real Free user at the limit against the real database.

**PENDING after merge and deploy (cannot be checked until then)**
`pranav-dev` must first be merged with Yash's `main` (merging to `main` auto-deploys to Railway, so it needs explicit approval). Then Yash creates the keys and adds them to Railway. After that, check on the deployed URL:
1. Railway env vars set: `STRIPE_SECRET_KEY` (`sk_test_...`), `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL` (the deployed URL, not localhost). Leave `UNLIMITED_USER_EMAILS` unset in production.
2. Stripe dashboard (Test mode): add a webhook endpoint `https://<railway-url>/api/stripe/webhook` for `checkout.session.completed`; its signing secret is the Railway `STRIPE_WEBHOOK_SECRET`. The local `stripe listen` secret will not work there.
3. Full journey on Railway: Free user reaches the limit, sees the upgrade panel, pays with a test card, becomes Pro, plan persists after reload, asks again and the run is saved.
4. Cancelled checkout on Railway leaves the plan unchanged.
5. A webhook with a bad signature gets 400 on the deployed URL.
6. Primary Sonnet demo question after upgrade.

### A10. Analyst Driver / "Why?" analysis (2026-10-20, branch `pranav-dev`, not merged)

Source of truth: `docs/ANALYST_DRIVER_ANALYSIS_PLAN.md`; requirements SPEC section 6A (DRIVER-001 to 009). Prompt-level feature on the existing ReAct loop. Loop, limits (6 iterations, 90 s, retry), `FinalAnswer` schema, citation registry, history, Stripe, usage and the database schema were not touched.

**What changed**
- `lib/agent/prompt.ts`: one-line `search_news` rule replaced; new "Why questions" section (10 rules): numbers first (financials, then one batched `calculate`, then search), identify the changing years, specific query from what was found using the company's common name, one search per company for peers, separate decline and recovery periods, filings authoritative over article figures, fact / inference / reported-driver separation, `[news-N]` marker on each reported-driver sentence, cautious causal language, graceful fallback when search is weak or fails, specific follow-ups. Also asks for `cost_of_revenue` alongside `gross_profit` for margins (VF reports no `GrossProfit` tag). Plain figure/comparison questions do not search unless the user explicitly asks for news.
- `lib/agent/tools/searchNews.ts`: added `from_year`/`to_year` (calendar-year window to Tavily `start_date`/`end_date`; 0/missing/invalid falls back to `time_range: "year"`, so old callers work). Description reworded for driver use.
- `scripts/try-driver.ts` (new), docs: SPEC 6A + TOOL-006, ARCHITECTURE, DESIGN trade-off 8.

**Deviation from the plan**: the plan says no tool changes, but `search_news` as built used `time_range: "year"`, so a question about FY2022-24 asked in Oct 2026 could only retrieve articles from the last 12 months (verified against live Tavily: window returns 2023-24 company releases, the default returns 2026 items). The year window is the minimal fix; it is the only code change outside the prompt.

**Tests** (Haiku 5.5, real Anthropic + SEC; Tavily real for 001/007/008/simple/advice, mocked for 002/004/005/006)
- `scripts/try-driver.ts`: offline 7/7 (date window, legacy call, news vs filing sources, fabricated news key dropped, article-only figure flagged); DRIVER-001 9/9, -002 6/6, -004 8/8, -005 5/5, -006 4/4, -007 8/8, -008 8/8; SIMPLE 3/3 (no `search_news` for "Compare Nike and Lululemon revenue" or "Nike revenue in FY2025"); ADVICE 2/2.
- Regressions: grounding 29/29, loop 14/14, news 6/6, stream 8/8, infra 21/21, history 24/24, clarify-ui 8/8, usage all passed (needs `NODE_OPTIONS=--conditions=react-server`), edge suite and `try-injection` (no PWNED, no buy call). `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass.

**Bugs found and fixed during the work**
- First prompt put citation markers only in the table; driver sentences were uncited (DRIVER-004 failed). Prompt now requires the `[news-N]` marker on each reported-driver sentence.
- A query using the SEC legal name ("V F Corp") returned other companies' articles; prompt now says use the common name.
- Tightened rule made the agent refuse the edge case "Also search news" (user asked explicitly); rule now allows search on an explicit request.
- Peer question put two companies in one query; now one search per company, in parallel. Extra sequential `calculate` calls pushed search late; prompt says batch.
- Several first-draft test regexes were too narrow (accepted "failed", "has not returned to its FY2022 level", and an article figure mentioned only as a flagged conflict). Fixed the tests, not the thresholds.

**Live trajectories** (3 required cases, `scripts/try-agent.ts`): VF decline + recovery: lookup, financials, calculate (11 values), 2 parallel searches (decline FY2023-24, recovery FY2025-26), answer; 4-5 iterations, 30.4 s. Lululemon vs Nike: 2 lookups, 2 financials, 1 calculate (15 values), 2 parallel searches (one per company), answer; 5 iterations, 30.7 s. Nike vs Lululemon revenue: no search, 4 iterations, 17.9 s. Across all driver runs: 16 to 36 s, 4 to 6 iterations; mean of the 3 required cases 26.3 s (target 60 s).

**Remaining risks / limitations**
- Browser checks: NOT RUN (no browser and no logged-in test session available here). The `/api/agent` request flow was checked via `runAgent`, the stream suite and the history suite, not through the UI. News sources are rendered by the existing `SourcesList`; whether they are visually distinguished from filings was not inspected.
- Behavior is prompt-driven on Haiku; not yet verified on Sonnet 5.5 (the demo model).
- Search snippets are 300 characters, so drivers are often thin or only from proxy/earnings-release pages. In some runs the agent honestly reported no reliable driver evidence (Lululemon vs Nike structural "why stronger" is not explained, only the recent compression).
- Figures quoted from articles (for example a tariff cost or an impairment amount) are not in the figure registry and are flagged by the existing "could not be matched" note rather than blocked.
- Two sequential searches (decline then recovery) can use all 6 iterations (seen once on DRIVER-001). Parallel searches are preferred by the prompt but not enforced.
- Mixed "why ... and should I buy" returns `kind: "answer"` with the diagnostic and a "can't give buy/sell advice" statement (counts as a successful question); previously undefined behavior, boundary itself unchanged.
- Nike has no `operating_income` in the fetched data (pre-existing), so operating-margin comparisons with Nike are unavailable.

### A11. Driver loop optimization (2026-10-20, branch `pranav-dev`, not merged)

Trigger: a Warner Music Group answer said "I did not look for drivers of the FY2024 dip", an implementation detail (the run had spent iterations on two sequential `calculate` calls and sequential searches). Requirements: SPEC DRIVER-010/011/012 and the AGENT-002 note.

**Changed**
- `lib/agent/intent.ts` (new): `isDriverAnalysis(question)` regex helper (why, what drove/caused/explains/led to/happened/changed, reasons/drivers for, explain, recover). `maxIterationsFor` returns 8 for driver wording, 6 otherwise. No LLM classifier.
- `lib/agent/loop.ts`: `MAX_ITERATIONS` constant replaced by a per-run `maxIterations`. Deadline, hard limit, timeouts, retries and forced-final logic untouched. Forced-final trace line is now "Writing the answer from the evidence gathered."; the last-step nudge asks for established / supported / uncertain and forbids mentioning steps, budgets or what was not searched; the unreachable fallback no longer says "allowed steps".
- `lib/agent/prompt.ts` ("Why questions"): rule 1 requires ONE calculate call with every foreseeable derived metric (margins, YoY and percentage-point changes, implied opex and opex margin); rule 2 groups years into material phases (about 2 pp or more is material; tenths of a point are secondary); rule 3 one search per phase or company, all issued in the same turn, max 3 searches; new rule 10 (plan the budget: about 5 steps, spare steps are not for wandering) and rule 11 (no process-limit language; "I did not find reliable evidence explaining ..." is the allowed form).
- `lib/agent/tools/index.ts`: found by the tests, not requested: the model sometimes wrote raw `[news-1]` markers, which the resolver left as dead text (only accession keys were rewritten). `resolveFinalAnswer` now rewrites raw `news-N` keys to `[n]` (unknown ones are dropped), same as filings. This strengthens citation resolution; nothing is weakened.
- Tests: `scripts/try-loop.ts` (+8 offline: driver question gets 8 model calls and `final_answer`-only on call 8, standard question still 6, neutral forced-final wording, intent matches/non-matches, ceilings), `scripts/try-grounding.ts` (+2: raw `news-N`), `scripts/try-driver.ts` (new `WMG` and `CEILING` cases, budget-wording check on every SEC-first case; two earlier test regexes corrected: the server's own "could not be matched" note is not the model asserting an article figure, and a refusal sentence like "I can't say whether to buy" is not a recommendation).

**Results** (Haiku 5.5, real Anthropic/SEC/Tavily, driver cases mocked as before)
- WMG regression ("Why did Warner Music Group's operating profitability change over the last five years, and what appears to have driven the biggest movements?"): 14/14. Trajectory lookup, financials, one calculate, 2 parallel searches (FY2025 decline window 2025; FY2022-23 improvement window 2022-23), final = **5 iterations, 29.0 s** (the observed failing run took more steps; the earlier driver set had needed 5 to 6). Answer states the rise to the FY2023 peak, the 2.5 pp FY2024-25 drop as the largest move, says the sources do not name the drivers, and uses "I did not find reliable evidence ..." wording; no budget language.
- CEILING: simple 3 iterations 7.8 s, standard comparison 4 iterations 18.6 s (no search), two-theme driver 5 iterations 36.6 s; all pass.
- Driver set D001/002/004/005/006/007/008, SIMPLE and ADVICE: 4 to 6 iterations, 18 to 32 s (D008 recovery question reached 6; the old behavior was also 5 to 6). Latency stayed in the 18-37 s range, so the unchanged 90 s deadline was never close.

**Remaining risks**: whether the model batches calculations and parallelizes searches is still prompt-driven (verified on Haiku, not Sonnet 5.5); the wording regex can miss unusual phrasings (the ceiling stays 6, the model can still search); search snippets are 300 characters so driver evidence can still be thin, now reported as "did not find reliable evidence" instead of "did not look"; browser checks still not run.

**A11 addendum: calculate truncation (found while measuring batching)**
- Bug: `calculate` did `slice(0, 20)` and silently dropped every expression past 20, with no error. A batched driver call of 23 expressions ("Computed 20 values") lost its cross-company gap rows, so the model sent a second `calculate` (diagnosed from the trace: the second call contained exactly the 3 dropped gap expressions). The prompt's one-batch guidance made this likely; the silent drop is a bug on its own (a tool must not return partial work as complete).
- Fix: cap raised to 50 per call (local, cheap) and overflow items now return an explicit per-item error ("Not computed ... send this one again") so the summary says "N failed". Tests in `try-driver.ts offline` (23 all computed; 53 gives 50 computed, 3 explicit errors).
- Decision (user): calculate calls are not capped by the prompt. The prompt says one batch normally suffices, but a further `calculate` is fine when a result is missing or another metric is needed for accuracy. The tests record calculate turns but do not fail on them.
- Other ways to handle this class of problem, not built: have the tool echo requested vs computed counts; validate the batch before running and tell the model to split it; let the model send named derived-metric templates (margin, YoY, gap) so the server expands them, which removes most hand-written expressions.

**Final A11 numbers** (Haiku 5.5, live): WMG 3 of 3 runs: 5 iterations, 26.7 to 29.3 s, one calculate turn, two searches in the same turn (parallel). Earlier samples before the final prompt tweak: 4 to 5 iterations, 1 of 6 sequential searches. Two-company two-theme driver question: 5 to 6 iterations, 34 to 42 s, sometimes a second calculate (now allowed). Driver set D001-008: 5 to 6 iterations, 15 to 42 s. Simple 3 iterations, standard comparison 4 (no search). All regression suites pass (grounding 31, loop 22, news 6, stream 8, infra 21, history 24, clarify-ui 8, usage 18, injection, edge); lint, tsc, build pass.

**Known flakiness**: roughly 1 in 3 earlier samples left one summary driver sentence without its `[n]` (prompt now has a concrete example; 3 consecutive clean runs after, not proof); one sample in a dozen used "did not research" (prompt rule 11 forbids it, no server-side scrub). In the final edge sweep the Adidas case ended in `not_covered` after three lookups without fetching Nike (model variation on an existing edge case, not part of this change).

### A12. Trace step count matches the visible steps (2026-10-20, branch `pranav-dev`, not merged)

Trigger: a VF vs Ralph Lauren driver answer showed "Researched in 5 steps" above a list of 9 tool calls (2 lookups, 2 financials, 1 calculate, 4 searches over 5 loop rounds). The label counted loop rounds (a decision recorded as N8 in an earlier audit entry); the list shows tool calls, so the two disagreed.

**Changed** (UI only, `components/agent-trace.tsx`): the count is now the number of tool-call rows listed, so the label always equals what the user can expand. While running, the header reads "Researching · N steps so far" (no count until the first tool call). Saved results on `/history/[id]` use the same component, so they show the same count. Loop, prompts, tools and schema untouched.

**Test**: `scripts/try-clarify-ui.ts` N8 check inverted to the new contract (3 parallel + 1 later call = 4 steps with 4 rows) plus singular, live-count and live-empty checks; 11/11 pass. `try-history` 24/24, lint, `tsc --noEmit`, build pass. Browser check NOT RUN: rendering verified with `renderToStaticMarkup` only.

**Deviation**: reverses the earlier "steps = loop rounds" decision (N8); that count is still available as the highest `iteration` in the trace if wanted. A run with many parallel calls now reads as a larger number than the iteration cap (up to 8 rounds can contain more tool calls).

### A14. Threads / Continuation (2026-10-20, branch `pranav-dev`, not merged)

**Requirements**: new SPEC 6B (THREAD-001..006), `docs/THREADS_CONTINUATION_PLAN.md`.

**Migration** `supabase/migrations/002_add_threads.sql`, applied manually in Supabase by the user; post-migration verification queries passed (user-confirmed). Deviations from the plan: sequential name (repo convention), no `ON DELETE CASCADE` on `runs.thread_id`, `thread_id` left nullable. Table grants added for `threads` so the insert/update policies are effective.

**Changed**: `lib/agent/context.ts` (new, pure), `lib/threads.ts` (new, admin writes + ownership), `lib/agent/prompt.ts` and `lib/agent/loop.ts` (optional `priorContext`; behaviour unchanged when empty), `app/api/agent/route.ts` (threadId, ownership, thread creation, `thread_id` on insert, `X-Thread-Id` header), `lib/history.ts` and `lib/history-parse.ts` (thread list/detail, `ThreadRow`, `groupByDay` takes an optional time accessor), `components/ask-form.tsx` (thread-aware workspace), `components/history/history-list.tsx`, `app/history/page.tsx`, `app/history/[id]/page.tsx` (`[id]` is now a thread id). Not touched: tools, calculator, citation registry, final answer schema, iteration limits, usage, Stripe, NDJSON events.

**Deviation**: prior turns go into the first user message as a wrapped block rather than as alternating chat roles (keeps system prompt cacheable and makes the "not evidence" framing explicit).

**Tests**: `scripts/try-threads.ts` 22/22 offline (3-run bound, truncation, no sources/tables/trace/URLs/citation markers, tag forging, message shape). `scripts/try-threads-live.mjs` all pass against the dev Supabase with two temp users and real agent calls: one thread per new conversation, follow-up reuses it with 2 runs attached and `updated_at` advancing, run 2 re-ran `get_financials` and cited its own sources, reference resolved ("that" = Nike), cross-user continue = 404 and saves nothing, RLS blocks read/insert/update of another user's thread, no delete, malformed/empty requests create no thread. Regressions: try-history 24, try-stream 8, try-usage 18, try-loop 22, try-grounding 31; lint, tsc, build pass. `try-clarify-ui.ts` fails to start in this environment with or without these changes (pre-existing, not investigated).

**Not run**: browser flow (no browser tool in this session): New Question after a thread, History list, open thread, follow-up chips, refresh, mobile, console errors. Stale-figure test (earlier answer has a different number than tool output) is covered only by the prompt rule and the isolation checks, not an adversarial live case.

**Remaining risks**: old `/history/<run id>` links no longer resolve (ids are thread ids now); the live thread page shows the streamed turn until `router.refresh()` lands, and keeps it if the best-effort save failed; threads created but never saved (client dropped mid-run) are hidden from History but remain in the table; `supabase/*-backup-oct20.csv` contain user data and are now git-ignored (commit `c092801`).

**Update (2026-10-21)**: the browser flow listed above as not run was later covered in a real headless browser (see A15 and A16): new thread and continuation, sidebar, refresh restore, scrolling, mobile width, no console errors. Still not browser-tested: the stale-figure adversarial case, and touch scrolling.

### A15. Conversation UX: auto-scroll and sidebar recent research (2026-10-20, branch `pranav-dev`, not merged)

Scope: components 2 and 3 of the conversation-UX pass. Component 1 (progressive answer streaming) is NOT implemented; it needs an additive NDJSON event and a switch to streaming model calls, so it is waiting for approval.

**Auto-scroll**: the page (window) is the scroll container; the composer is a sticky in-flow dock, so it cannot cover the last content at max scroll. New `components/research/use-follow-scroll.ts`: passive window scroll listener + one `ResizeObserver` on the workspace content, at most one scroll per animation frame, no polling. Only an upward scroll away from the bottom pauses following; coming within 150 px of the bottom resumes it (our own jump to the new question goes downward, so it does not pause). `components/ask-form.tsx` re-pins on each question and jumps (no smooth animation) to the new turn.

**Sidebar**: `AppShell` loads `listThreads(user.id, 20)` (titles and run counts only, cookie client so RLS applies; no new table or query path) and passes it to `Sidebar`. "Recent research" list with active highlight (`/history/<id>`), truncation with full title in the tooltip, empty and error text, and "View all history". `History` nav item is only active on `/history` itself. A `comps:thread-activity` event from the workspace (fired when `/api/agent` returns `X-Thread-Id`) shows a new thread or moves a continued one to the top immediately; the server list takes over after `router.refresh()`. Hidden on the collapsed rail and below `md` (no mobile drawer exists; History link remains).

**Files**: `components/research/use-follow-scroll.ts` (new), `components/ask-form.tsx`, `components/layout/{sidebar,app-shell,events}.ts(x)`, `lib/history.ts` (`limit` parameter).

**Verification (real browser)**: headless Chrome (Playwright, driven from outside the repo) against `next start`, two temp users, seeded long threads, two real agent calls. 20+ checks passed: sidebar shows only own threads newest first, other user's thread absent, active highlight, long title truncated with tooltip, link opens the right thread, submit puts the new question in view, continued thread moves to top immediately, page stays within 200 px of the bottom while content grows (6/6 samples), wheel-up pauses following (scrollY unchanged for 3.5 s while still researching), returning to the bottom resumes it, composer does not overlap the last turn, refresh restores 3 turns and server order, a new thread from home appears at the top of the sidebar after submit, mobile 390 px has no sidebar and no horizontal overflow, no console errors. Lint, `tsc`, build pass. Test script lives in the session scratchpad, not the repo.

**Limitations**: sidebar does not show on mobile; the home page does not highlight the just-created thread; a thread shown optimistically but whose run never saves disappears on the next page load; touch scrolling was not tested separately from wheel.

### A16. Progressive answer streaming (2026-10-21, branch `pranav-dev`, not merged)

**Requirement**: SPEC STREAM-006 (new, additive). Design approved by the user before implementation.

**What changed**: `lib/agent/loop.ts` consumes the model call as a stream (`beta.messages.stream`, same params) and still awaits the complete message, so validation, `resolveFinalAnswer`, citation verification, persistence and success semantics are untouched. For `final_answer` it forwards the partial `answer_markdown` (new pure `lib/agent/partialJson.ts`) as throttled `answer_delta` NDJSON events (`types.ts`, `runStream.ts`, route plumbing). `final_answer` is sent with `eager_input_streaming: true` on the streaming path only. Client (`ask-form.tsx`, `DraftAnswer` in `answer-view.tsx`) shows "Writing the answer" with the prose (markers hidden) until `final` replaces it. Saved runs and History never stream.

**Finding that changed the design slightly**: without eager input streaming the API delivers the strict tool input in 1 to 2 large bursts (live Haiku and Sonnet: previews at 6 then 438 characters), which is not progressive. With `eager_input_streaming` Haiku produced 11 previews and Sonnet 5 to 6 per answer. Previews start when the answer starts (after research), end about 1.5 to 3 s before `final` (tables, citations and follow-ups are generated after the prose).

**Failure behavior**: any streaming failure (HTTP error, non-SSE reply, bad JSON, truncated stream, listener exception) falls back once to the non-streaming call inside the remaining time budget; user cancel never retries; a throwing preview listener only stops previews. Kill switch `AGENT_STREAMING=off`.

**Tests**: `try-partial-json.ts` 16/16 (every prefix of a document containing quotes, backslashes, newlines, unicode, `\u` escapes, split surrogate pairs and a decoy key; incomplete escapes held back, malformed ones stop safely). `try-streaming.ts` 16/16 with a mocked SSE endpoint: incremental, monotonic, throttled previews that are prefixes of the final prose; four fallback modes; throwing listener; kill switch; abort without retry; NDJSON order and that only the validated answer is saved once; crash after a preview gives `answer_delta,error` and a failed save. Regressions: history 24, stream 8, usage 18, loop 22 (run with `AGENT_STREAMING=off` since its mock is plain JSON), grounding 31, threads 22. Lint, `tsc`, build pass. Live real-API checks (`try-streaming-live.ts`): Haiku 5.5 and Sonnet 5.5 (with the `server-side-fallback-2026-07-01` beta and `fallbacks: default`) both streamed with no fallback, monotonic previews, and the last preview equal to the final prose after marker stripping. Browser (Playwright, real agent): draft text visible and growing (21, 67, 107 characters), replaced by the validated answer, no streaming UI after reload; the earlier 20+ sidebar and scroll checks were rerun and pass.

**Not verified / limits**: the refusal-fallback path of Sonnet was not triggered, so streaming through an actual refusal fallback is untested; citation-marker hiding in the draft is covered offline only; previews show only prose (no tables) by design; the draft can differ from the final text where the server removes or rewrites unverified markers.

### Status summary after A14 to A16 (2026-10-21)
- Threads / Continuation, sidebar recent research, follow-scroll and progressive answer streaming are implemented and committed on `pranav-dev` (`438f900`, `8913885`, `c9a2728`). Nothing is merged to `main` or deployed.
- Open before merge: a manual smoke test in the user's own browser; the Sonnet refusal-fallback path under streaming is untested; `scripts/try-clarify-ui.ts` does not start in this environment (pre-existing).
- Untracked and intentionally not committed: `docs/COMPS_AUDIT_FEAT.md`.

### A17. Smooth answer rendering: paced prose, streamed tables, sources and follow-ups (2026-10-21, branch `pranav-dev`, not merged)

**Trigger (user)**: the answer streamed briefly, froze, then everything else appeared at once. Measured on a real run: prose preview 45.1 to 46.7 s (16 updates, 988 characters), nothing visible 46.7 to 50.2 s while the model wrote tables, citations and follow-ups, then `final` added all of that together.

**Changed**
- Backend (additive): `lib/agent/partialJson.ts` gets a tolerant partial-JSON parser (`extractPreviewParts`) that reports only COMPLETE table rows, citations and follow-ups; `previewExtras` in `lib/agent/tools/index.ts` verifies them against the run's own registry (row withheld unless every figure matches retrieved data, using the same `figuresIn`/`ctx.figures` test as the final check; source only if its key was returned by a tool); new NDJSON event `answer_extras` (cumulative), plumbed through `loop.ts`, `runStream.ts`, the route. `final` is unchanged and still the only saved, counted and authoritative result.
- Client: `components/research/use-reveal.ts` (new) paces the prose (never ahead of received text, ~120 to 500 chars/s, word-boundary, speeds up once `final` arrives, honors reduced motion) and reveals table header/rows, sources and follow-ups one at a time in page order; `DraftAnswer` in `answer-view.tsx` shows them with a fade-in and a status line ("Writing the answer", then "Checking sources and building tables"); `ask-form.tsx` keeps the preview until it has finished, then shows the validated `AnswerView` (and delays the thread `router.refresh()` until then, so the saved turn cannot cut the preview off); `FollowUpList` gets `disabled`; citation markers (including a half-arrived `[1`) are hidden in previews.

**Tests**: `try-partial-json.ts` now also covers the structure parser (every prefix of a full document never throws, reports only complete items equal to the full document's, monotonic; decoy keys; unfinished numbers) and `previewExtras` (unverified figure withheld, fabricated figure never leaves the server, unknown key dropped, duplicate `n` ignored, header gating, cap of 3 follow-ups); `try-streaming.ts` 21/21 (adds extras previews and that unknown citation keys and unretrieved figures are never previewed). History 24, stream 8, usage 18, loop 22, grounding 31, threads 22 pass. Lint, `tsc`, build pass. Live, real API, Haiku 5.5 and Sonnet 5.5: previews monotonic, preview rows and sources are subsets of the final ones, no fallback. Browser (real Chrome, real agent, Nike vs Under Armour 5 year question): preview from 15.6 s to 22.2 s with 114 visible changes, longest gap with no visible change 137 ms, rows appearing 0 to 12 one at a time, sources 0 to 6, swap to the validated answer 43 ms after the last preview change, final has linked markers and sources, no console errors. The earlier 20+ sidebar, scroll and thread checks were rerun and pass.

**Trade-offs and limits**: pacing deliberately adds up to a few seconds of reveal time after the model has finished writing (about 4 to 7 s of continuous motion on a typical answer); the validated answer is held back at most ~2.5 s for the preview to finish. Markers are hidden during the preview (the "cheap" option), so prose shows no citation links until the validated answer arrives. A row withheld from the preview (figure not matched) appears only in the final answer, so a table can gain a row at the swap. Touch devices and the Sonnet refusal-fallback path were not tested.

**A17 review (2026-10-21)**: the user reviewed the smooth rendering in their own browser and approved it ("working well"). This supersedes the "manual smoke test" item in the status summary above for A14 to A17.

### Status summary after A17 (2026-10-21)
- Implemented and reviewed on `pranav-dev`: Threads / Continuation (A14), follow-scroll and sidebar recent research (A15), progressive answer streaming (A16), smooth paced rendering with streamed tables, sources and follow-ups (A17). Branch pushed to origin; NOT merged to `main` and not deployed (merge auto-deploys to Railway and needs explicit approval).
- Still open: Sonnet refusal-fallback under streaming and touch scrolling are untested; `scripts/try-clarify-ui.ts` does not start in this environment (pre-existing); `docs/COMPS_AUDIT_FEAT.md` is untracked and intentionally not committed.

### A18. Multi-turn continuity fix: earlier turns stay visible during follow-ups (2026-10-21, branch `pranav-dev`, not merged)

**Bug (user)**: in a new conversation, a follow-up (typed or a suggested chip) replaced the previous question and answer instead of appearing below it.

**Root cause (presentation only; thread identity, persistence and context were correct)**
- Home page `/`: `AskForm` without `initialThread` held exactly one live turn in flat state (`asked`, `steps`, `result`, `draftAnswer`, ...). `ask()` cleared it at the start of every question, so turn B overwrote turn A, and `window.scrollTo({ top: 0 })` ran on every ask. Present since Threads (`438f900`), not introduced by streaming. The request still carried `threadId` (from `X-Thread-Id`), so the run was appended to the same thread and `loadPriorContext` gave the model the bounded context.
- Thread page `/history/[id]`: the live turn was hidden as soon as `turns.length !== liveBase`, so the code depended on `router.refresh()` landing before the next question. A17 delayed that refresh until the preview finished revealing, which widened the race: a follow-up asked before the refresh landed erased the previous live turn, and the late refresh then hid the new turn mid-stream.

**Fix**
- New `components/research/conversation.ts` (pure): `LiveTurn` (per-turn question, steps, draft, extras, result, error, limit), `newTurn`, `updateTurn` (by id; other turns keep identity), `applyEvent` (one NDJSON event into its own turn), `turnView` (preview/result visibility, logic unchanged from A17).
- `components/ask-form.tsx`: saved turns are the snapshot loaded when the page opened; turns asked in this visit are an array of live turns appended below them. Each `ask()` captures its turn id, and every stream event, error, 402 and network failure updates only that turn. A finished turn stays a live turn until the page is loaded again, so `router.refresh()` (still used for the plan badge and sidebar) can no longer hide or duplicate a turn. One run at a time (`ask` ignores calls while a run is active). Only the newest turn offers follow-ups, clarify choices and Try again, and only when idle, the same rule saved turns already followed. Typed follow-ups, chips, choices and retry all go through the same `ask()`. A follow-up jumps to the new turn instead of the top; the first question on `/` still starts at the top. `useFollowScroll` is unchanged.
- Not changed: API route, agent, NDJSON events, persistence, schema/RLS, usage, Stripe, sidebar, History.

**Tests**
- `scripts/try-conversation.ts` (new, offline) 15/15: earlier turn object identity unchanged across every event of a follow-up, `answer_delta`/`final`/`error` touch only their own turn, three turns keep order, a mid-stream error and a pre-stream failure stay on the failing turn, unknown-id events are no-ops, visibility rules.
- Regressions: threads 22, history 24, stream 8, streaming 21, partial-json 33, usage 18. Lint, `tsc --noEmit`, build pass.
- Real browser (Playwright Chromium driven from the session scratchpad against `next start`, dev Supabase, temp users deleted afterwards, real agent), 26/26 checks on the final run (an earlier run had two fixture-only failures: a text-length check that did not allow for the older turn losing its follow-up chips, and Test 7's own intercepted 400 counted as a console error). Home page: A, then a suggested follow-up B, then a typed C ("the first company's operating margin"). Every earlier turn was present with its answer in every 400 ms sample while B (31 samples) and C (37) streamed, with previews visible. Starting a follow-up did not scroll to the top. B and C sent A's thread id; 3 runs persisted in one thread in order; C's trace looked up Nike (reference resolved from context). An interrupted follow-up (stream ended with no `final`, intercepted) showed the error only on turn 4. "New question" sent no `threadId` and showed only the new turn. Reopening from the sidebar and reloading rebuilt the 3 turns in order. A real follow-up on the thread page kept all 3 saved turns visible in all 22 samples, was still shown exactly once 3 s after `router.refresh()` landed, and survived a reload as turn 4 (4 runs, one thread). Another user continuing the thread got 404 and nothing was saved. No console errors. Saved runs B and C were non-answers (status `failed`), and the next question was still allowed, consistent with failed runs not counting.
- Seeded browser case (no model spend): free user with 3 successful runs opens the thread and clicks a suggested follow-up -> the 402 panel appears only on turn 4, the 3 saved answers are unchanged, and nothing is saved.

**Known limitations**
- `/` keeps its URL after the first answer, so reloading `/` returns to the empty state; the conversation is reopened from the sidebar or History (reload of `/history/<id>` rebuilds it fully). Changing the URL in place (`history.replaceState`) was not done, because a later `router.refresh()` would render the thread route and remount the workspace, which would abort a follow-up that is streaming.
- Turns asked during a visit show "Asked just now" until the page is reloaded; a turn whose best-effort save failed stays visible until reload (as before).
- Earlier turns lose their follow-up chips when a newer turn starts (same as saved turns).
- Out of scope, observed: in the live run the agent said Nike reports no operating income line, so it could not give an operating margin. This is a data/metric-mapping question for the agent, not part of this fix.

### A19. Comparability Audit MVP (2026-10-21, branch `pranav-dev`, not merged)

**What**: a new `/audit` page ("Comparability Audit" in the sidebar and mobile nav) and `POST /api/audit`. Given two tickers and a reporting period, it decides per metric (revenue, operating income, operating margin, net income) whether the reported figures are genuinely comparable, with statuses `COMPARABLE | ADJUSTED | PARTIALLY_COMPARABLE | NOT_COMPARABLE | INSUFFICIENT_EVIDENCE`. A comparability review of SEC XBRL data, not a statutory audit. Plan: `docs/COMPS_AUDIT_SPRINT.md` (left untracked, as found).

**Design**
- `lib/audit/types.ts`: the contract (values, evidence, adjustments, checks, caveats, evidence quality, human-review flag, overall assessment, checklist, limitations) plus a runtime validator run on every audit before it leaves the server (reported value needs evidence and a period; normalized value needs a matching adjustment; adjustments may only cite evidence in the same metric; a missing value can only be `INSUFFICIENT_EVIDENCE`/`NOT_COMPARABLE`) and request validation (ticker pattern, two different tickers, period `latest` or 2009 to current year).
- `lib/audit/engine.ts` (pure, deterministic): period selection anchored on company A; B takes the same fiscal-year label unless that label ends more than 183 days away and another B year is nearer, in which case the realignment is recorded as a `period_realignment` adjustment. Year-end gap <= 31 days aligned, <= 183 partial, else not comparable. Currency: only USD facts are used; a metric that exists only in another unit is `NOT_COMPARABLE` with "no documented FX rate, no conversion". Definitions: XBRL concept compared; known non-like-for-like pairs (revenue including vs excluding assessed taxes; ProfitLoss vs NetIncomeLoss) are `PARTIALLY_COMPARABLE`, other concept differences are a caveat. Operating margin goes through `evaluateExpression` (the existing calculate engine) and is re-verified by `verifyDerivation`, which rejects any formula with a number not in the evidence or whose re-evaluation does not match the stated output. Zero revenue -> margin undefined.
- `lib/audit/retrieve.ts`: reuses `get_financials` through `executeTool` (same 20 s timeout + one retry) and its citation registry for filing URLs; `getFinancials.ts` only gains `export` on `TAGS` (no behavior change) so non-USD units can be detected. Retrieval failures become an explicit company `error`, never an empty success.
- `lib/audit/interpret.ts`: ONE bounded model call (forced tool, 20 s timeout, no retries, 1200 max tokens, `LLM_MODEL` or Haiku 5.5) that only adds notes. A note is dropped unless every digit in it is a figure/date/year/day-gap already in the audit and it has no buy/sell/hold language; it cannot change statuses or figures. Failure leaves the deterministic audit and adds a limitation. Skipped when no metric has evidence or `ANTHROPIC_API_KEY` is unset.
- `lib/audit/handler.ts` + `app/api/audit/route.ts`: auth (401 before anything else), validation (400), per-user in-memory limit of 10 audits/hour and one concurrent audit (429), 45 s deadline (504), contract validation (500 on violation). Plain JSON, not streamed.
- Usage/Stripe: audits do NOT read or write `runs` and do not count against research questions; the in-memory limiter is the cost bound instead. No schema change, no migration.
- UI `components/audit/audit-workspace.tsx`: inputs, idle state with example pairs, loading, error, partial-audit banner, overview table, per-metric cards (values with period and currency, checks, adjustments with formulas, caveats, labeled AI notes, evidence quality, human-review flag, expandable evidence with 10-K links, accession and us-gaap concept), analyst checklist with checkboxes, limitations, Markdown download (`lib/audit/report.ts`, includes checklist state).

**Nike operating income**: checked directly: Nike's companyfacts has 0 `OperatingIncomeLoss` facts (only pre-tax income tags). Rebuilding it from pre-tax income + interest would be a non-GAAP reconstruction, so the audit reports `INSUFFICIENT_EVIDENCE` with "not estimated".

**Tests**
- `scripts/try-audit.ts` (new, offline) 41/41: same-period comparable (margins 20%/10% via calculate, contract valid), fiscal mismatch (NKE May vs LULU Feb realigned, 124-day gap partial, disclosed, checklist), realignment into an aligned period -> `ADJUSTED`, JPY-only -> `NOT_COMPARABLE`, missing OI -> `INSUFFICIENT_EVIDENCE` (margin too), unevidenced formula input rejected, adjustment citing foreign evidence fails validation, wrong output rejected, negative OI verifies, tampered normalized value fails validation, zero denominator, whole-company retrieval failure, mixed partial audit, definition conflict, Markdown export, invalid inputs (5), auth 401 with no retrieval, 400 with no retrieval, 200 path, rate limit 429, per-user limit, AI notes with invented figure / advice dropped, statuses untouched, model failure harmless.
- Regressions (offline): usage, partial-json, threads, conversation, history, streaming all pass. Lint, `tsc --noEmit`, `npm run build` pass.
- Live (real SEC, real model): NKE vs LULU FY2024 in 3.4 s: LULU realigned to FY2023 (2024-01-28), revenue and net income partially comparable (124 days), operating income and margin insufficient (Nike), LULU margin 2132676000 / 9619278000 * 100 = 22.17 (hand-checked), 4 grounded AI notes + summary kept. KO vs PEP latest: all 4 comparable, FY2025 year-ends 4 days apart, margins 28.7% / 12.2% (13762000000 / 47941000000, 11498000000 / 93925000000). NKE vs TM: Toyota flagged JPY, not converted. Every value links to its 10-K (note: get_financials picks the most recently filed 10-K reporting the period, so a FY2024 value may cite the FY2026 10-K's comparative column).
- HTTP against `next start`: `/audit` logged out -> 307 `/login`; `POST /api/audit` logged out -> 401. Server-side render of the result view with the two live audits: status badges, SEC links and checklist render.
- NOT done: interactive browser check of the logged-in page (no browser automation or test login in this session). Research page was not re-checked in a browser; its code is untouched apart from the sidebar nav entry.

**Remaining risks**: rate limit is per process (resets on deploy; would need a store if Railway scales out). No audit persistence or history. Restatements are not compared (latest filed value wins). No quarterly recalendarization, segment or non-GAAP data. IFRS/20-F filers get insufficient evidence or currency flags. `docs/SPEC.md`/`ARCHITECTURE.md` do not yet describe the audit feature.

### A20. Comparability review inside research answers (2026-10-21, branch `pranav-dev`, not merged)

**What**: research answers that compare two or more companies now show a **Comparability review / cautions** panel above the answer, built by the existing audit engine. The research answer, tables, citations, notes, follow-ups, streaming and `/audit` are unchanged.

**Architecture (bounded enrichment, not a new agent tool)**
- `lib/audit/research.ts`: `planResearchAudit` reads the run's own trace: tickers from SUCCESSFUL `get_financials` actions (order = anchor first, max 3 companies, so up to 2 pairs), fetched metrics, calculate labels, and the years shown in the answer's tables/prose. No keyword matching on the question, no model call. Triggers only for `kind: "answer"` with 2+ companies and at least one supported metric. `runResearchAudit` calls `fetchCompanyData` (served by the in-memory SEC cache the research just filled: measured 1 ms) and `buildAudit`, validates every audit with `validateAudit`, and returns a `ResearchAuditSummary` (new type in `lib/audit/types.ts`, with a tolerant reader `toResearchAudit`). Bounded at 6 s with a real timer; any failure returns `status: "unavailable"`.
- Period: the most recent FY shown in the answer is audited (`latest` only when no year is shown); the engine's realignment and gap caveats are kept; multi-year research adds "only FY… was audited; multi-year trends and growth rates were not checked".
- Coverage: findings only for audit metrics the research used. Unsupported metrics are listed as "Not audited": fetched ones (gross profit, cost of revenue, cash flow, inventory) and calculate categories (growth rates, gross/net margin, other ratios). A fixed coverage note is always shown.
- Stream (`lib/agent/runStream.ts`): optional `deps.audit`, run after the agent and before the save; the summary is saved as `runs.trace.audit` (existing JSON column, no migration) and sent as a new `audit` event AFTER `final`. A throw is caught (no event, run saved normally). `final`, status and usage are untouched. SPEC STREAM-002/007 and ARCHITECTURE updated.
- Resource controls: no model call (the standalone audit's AI interpretation is NOT used here); runs only after a validated answer that already passed auth + usage checks on `/api/agent`; one audit per research run; the `/api/audit` rate limiter is not involved because no extra model or uncached SEC spend occurs.
- Client: `LiveTurn.audit` (set only by its own turn's `audit` event), `PersistedRun.audit` (only from a saved `trace.audit`; older runs show nothing, malformed summaries and non-`https://www.sec.gov/` links are dropped). `components/research/comparability-cautions.tsx` renders above `AnswerView` in live and saved turns, once the validated answer is visible (the event arrives with `final`, so the page does not jump). States: cautions (status, explanation, SEC filing links), clean ("N supported metrics checked; no material issues identified for the audited period"), unavailable (fixed text, research still shown). "View detailed audit" links to `/audit?a=&b=&period=`, which now prefills the form (nothing runs until submitted).

**Tests**
- `scripts/try-research-audit.ts` (new, offline) 32/32: trigger for 2 companies; no trigger for single company, non-answer kinds, a failed `get_financials`, unsupported-only metrics; supported/unsupported metric lists; historical year chosen from tables; multi-year flagged and stated; missing Nike OI -> caution; gap caution with SEC links; explicit period; result byte-identical after the audit; clean pair; 3 companies -> 2 pairs; retrieval failure and hang -> unavailable; stream order `step, answer_delta, final, audit`; `final` unchanged; audit saved in trace with status unchanged; audit throw -> final + save, no event; non-answer saved as failed with no audit; reload parsing (saved, none, malformed, legacy, non-SEC URL dropped); per-turn state.
- Regressions: audit 41, streaming 21, stream 8, conversation 15, history 24, threads 22, usage 18, partial-json 33, loop 22, grounding 31. Lint, `tsc --noEmit`, build pass. Render smoke of the panel's three states.
- Live acceptance (real agent, real SEC, `scripts/try-research-audit-live.ts`, no DB): "Compare Nike and Under Armour on revenue, profitability, margins and growth. Highlight the biggest differences." -> answer in 35.2 s with 5 tables, 6 sources, 3 follow-ups; audit `partial`, FY2026 (NKE ended 2026-05-31 vs UAA ended 2026-03-31): revenue and net income partially comparable (61 days), operating income and margin insufficient (Nike), unaudited: cost of revenue, gross profit, gross/net margin, growth rates, other ratios; limitation lists FY2021 to FY2025 as not audited.
- NOT done: browser check of the logged-in research page, thread reload with a real DB row, and live follow-up turns (no browser automation or test login in this session). Covered offline by the conversation, history and research-audit tests only.

**Limitations**: one fiscal year per research answer; companies beyond 3 are not audited; the anchor is the first company the agent fetched, not necessarily the first named; year detection relies on "FY2024"-style labels in the answer (bare years only as a row's first cell); the audit runs before the save, adding milliseconds normally and at most 6 s if the SEC cache was evicted.

**A20 follow-up fix**: when the newest year a research answer shows exists for only some companies (e.g. Microsoft has filed FY2026, Apple not yet), the review would have marked every metric insufficient. `runResearchAudit` now audits the newest year in the research that every company reports, labels that year, and lists the others as not audited. Test R04b added (research-audit 33/33).

**A20 example question**: `components/ask-form.tsx` example "Compare Nike and Under Armour's inventory and operating cash flow trends" (uses only unaudited metrics, so no review) replaced with "Compare Nike and Under Armour's revenue, operating income and net income". Live run (real agent and SEC, no DB): `answer` in 28.8 s, 3 tables FY2021 to FY2026, 6 sources, 3 follow-ups; review `partial` for FY2026 (NKE ended 2026-05-31 vs UAA ended 2026-03-31): revenue and net income partially comparable (61 days), operating income and margin insufficient (Nike), FY2021 to FY2025 stated as not audited. Lint and `tsc` pass.

### A21. Warm Neutral light theme (2026-10-21, branch `pranav-dev`, not merged)

**What**: frontend-only visual refresh from the dark theme to a Warm Neutral light theme (cream, off-white, forest green, olive-gray). Layout, information architecture, components, streaming, audit, persistence, auth, billing and the agent are unchanged. No new dependencies, env vars or migrations.

**Changes**
- `app/globals.css`: every token re-valued; `color-scheme: light`. The app has no dark-mode media query, theme provider or stored preference, so it stays light when the OS prefers dark. New `--bg-sidebar` token (`bg-sidebar` utility). Selection and scrollbar comment updated.
- Tokens: canvas `#f7f5ef`, sidebar `#efeee6`, cards `#ffffff`, subtle `#f2f1ea`, hover `#e8e7dd`; borders `#daddd3` / `#e4e5dc` / `#c6cbbf`; text `#26372e`, `#4e5b52`, `#5d6b61`, `#64705e`; accent `#305444` (hover `#264437`); semantic: comparable `#2f6b47`, caution `#8a5b0e`, not comparable `#a23b3b`; insufficient evidence stays neutral gray (`ink-3`).
- Deviation from the requested palette: secondary text `#627066` and olive `#71816d` were darkened (to the `#4e5b52` / `#5d6b61` / `#64705e` tiers) because `#627066` is 4.48:1 on the sidebar and olive is 3.8:1 on the canvas. Measured with a WCAG contrast script: primary, secondary and muted text, the accent and the three status colors are at least 4.5:1 on every surface; faint labels are about 4.5:1 on the sidebar and above it elsewhere.
- Primary buttons (composer send, auth submit, clarify "Ask", audit submit): `bg-ink … hover:bg-white` -> `bg-accent … hover:bg-accent-hover`. Clarify option hover `text-white` -> `text-accent`.
- Sidebar: hard-coded `bg-[#111110]` -> `bg-sidebar`; nav rows weight 500; active item `text-accent` on `bg-hover`; hover `bg-hover/60`.
- Typography: Geist Sans / Geist Mono were already loaded via `next/font/google` (unchanged). Page titles and section headings (incl. markdown h1 to h3 in answers) `font-medium` -> `font-semibold`.
- `components/answer-view.tsx` (Prose): markdown `th`/`td` get header/row borders (GFM column alignment `style` is passed through) and `blockquote` gets a left rule. Parsing and rendering logic unchanged.
- `app/layout.tsx`: `themeColor` `#f7f5ef`. `next.config.ts`: `devIndicators: false` (per the Next 16.4.2 bundled docs; no CSS hiding).
- The comparability review panel needed no edits: it uses the semantic tokens, so cautions, clean and unavailable states recolor automatically.

**Tests**: `npm run lint` clean; `npx tsc --noEmit` clean; `npm run build` succeeds and the production CSS contains none of the old dark colors. Dev-server smoke: `/login` and `/pricing` return 200 and serve the light tokens. No frontend test suite exists; no eval cases apply (no agent change).

**Not verified**: no browser visual pass yet (answer tables, the three review states, `/audit`, history, pricing, login, mobile, keyboard focus, OS dark mode). The dev indicator change needs a dev-server restart. `docs/COMPS_UI_REBUILD_PERPLEXITY_FINANCE.md` section 5 still lists the old dark tokens and is superseded by `app/globals.css`.

### A22. Deployment guide audit and rewrite for Railway handoff (2026-10-21, branch `pranav-dev`, commit `acfcc0a`, not merged)

**What**: documentation only. `docs/DEPLOY_GUIDE.md` was re-audited against the repository and rewritten as a runbook for Yash, the deployment owner. No application code, env files, migrations, dependencies or Railway/Supabase/Stripe settings changed. Nothing was merged or deployed. The request named `DEPLOY.md`, but the repo has none, so the existing `docs/DEPLOY_GUIDE.md` was updated instead of adding a second file.

**Verified from the repo**
- Architecture: one Railway service (Next.js 16 app, root `/`). Install `npm ci`, build `npm run build`, start `npm start`, Node `22.x` from `engines`. No `railway.json`, `nixpacks.toml`, Dockerfile or Procfile. `next start` binds `0.0.0.0:$PORT` (Next 16 bundled CLI docs). There is no service-to-service networking.
- Branches: `origin/main` is still `718807c` (Step 1). `pranav-dev` was 46 commits ahead and 0 behind before this doc commit, so a PR has no conflicts.
- Env inventory: every `process.env` reference in `app/`, `lib/`, `components/` and `proxy.ts` is accounted for. `.env.example` lists all 11 app variables; it leaves out only the optional `AGENT_STREAMING` kill switch. `BASE` and `NO_AI` are script-only. Per the Next 16 docs, `NEXT_PUBLIC_*` values are inlined into the server bundle as well as the browser bundle during `next build`, so `NEXT_PUBLIC_APP_URL` changes need a rebuild even though only `lib/stripe.ts` reads it.
- Persistence: Supabase Postgres, not MongoDB (the deploy request assumed MongoDB Atlas; nothing in the repo uses it). Comparability reviews are stored in `runs.trace.audit`, so no migration is needed after `002_add_threads.sql`.
- Auth: Supabase email + password, `emailRedirectTo` = `${origin}/auth/confirm`. The production Site URL and Redirect URLs must include the Railway domain. There are no custom cookie or CORS settings.

**Guide changes**: the audience changed from Claude operating the merge to Yash. The merge now goes through a PR with "Create a merge commit" (replacing the direct fast-forward push), followed by conflict handling, post-merge tree and SHA checks, and resyncing `pranav-dev`. The guide adds a labeled architecture table ([repo] vs [dashboard] vs "Requires confirmation from Yash"), a full env var table with a redacted Railway template, the Supabase project-separation question with a persistence check query (`has_thread`, `has_review`), Supabase Auth URL setup, the LLM/SEC/Tavily integrations, a deploy runbook in phases A to F, and a browser checklist with 6 prompts. The checklist covers the comparability review (shown on multi-company answers, absent on single-company ones, cautions/clean/unavailable states, "View detailed audit"), threads and follow-ups, the Free limit returning 402, the test-mode upgrade, and the Warm Neutral theme, Geist font and no dev indicator. Also added: a troubleshooting table, rollback via Railway redeploy or a PR that runs `git revert -m 1` (no force push), and security hygiene. Kept from the old guide: the migration 002 check and apply steps, Stripe webhook setup, curl checks and gotchas.

**Tests run** (to confirm the commands in the guide): `npm run lint`, `npx tsc --noEmit` and `npm run build` pass, and the route table matches the guide. Offline suites all pass: `try-history`, `try-stream`, `try-streaming`, `try-research-audit`, and with `NODE_OPTIONS=--conditions=react-server`: `try-usage`, `try-stripe`, `try-threads`, `try-audit`. `try-stripe` and `try-threads` throw a `server-only` error without that flag; the guide now states the flag. The secret scan of the diff found no matches apart from the guide's own scan command.

**Deviations**: the guide stays at `docs/DEPLOY_GUIDE.md` (not `DEPLOY.md`). The MongoDB sections in the request were replaced with Supabase. One platform claim is not verifiable from the repo: Railway's 15-minute maximum HTTP request duration. The guide says so and links Railway's docs.

**Pre-deploy blockers (unchanged by this entry)**: migration 002 must be confirmed or applied on the production Supabase project before the merge, or runs stop saving and usage limits silently stop working. The Stripe test-mode dashboard webhook endpoint does not exist yet. The Supabase Auth URLs need the Railway domain.

**Requires confirmation from Yash**: the live domain and that Railway deploys from `main`; whether production shares the dev Supabase project; whether 002 is applied; whether "Confirm email" is on; whether app sleeping is off with 1 replica; the production `LLM_MODEL` (Sonnet is mostly unverified); and ownership of production keys and dashboards.

**Remaining risks**: local Node here is v26 while Railway uses 22.x, so validate on 22 before merging. None of the production checks in the guide have been run yet.

### A23. Solid comparability status badges on `/audit` (2026-10-21, branch `pranav-dev`, not merged)

**What**: frontend-only. In `components/audit/audit-workspace.tsx`, the `STATUS_STYLE` badges for the five comparability statuses change from outlined (tinted border plus colored text) to solid fills with white text, so each metric's outcome reads at a glance. Statuses, labels, audit logic, the API, persistence and the research-answer comparability panel are unchanged. No new tokens, dependencies or env vars.

**Mapping**: `COMPARABLE` -> `bg-pos`, `ADJUSTED` -> `bg-accent`, `PARTIALLY_COMPARABLE` -> `bg-warn`, `NOT_COMPARABLE` -> `bg-neg`, `INSUFFICIENT_EVIDENCE` -> `bg-ink-3` (neutral gray, as in A21), each with a matching border and `text-white`.

**Tests**: WCAG contrast of white text on each fill, computed from the `app/globals.css` tokens: positive `#2f6b47` 6.33:1, negative `#a23b3b` 6.51:1, warning `#8a5b0e` 5.86:1, accent `#305444` 8.48:1, muted `#5d6b61` 5.61:1. All pass AA (4.5:1), and the code comment's "at least 5.6:1" holds. `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` succeeds. No frontend test suite exists, and no eval cases apply (no agent change).

**Not verified**: no browser visual pass of `/audit` with real results (badge sizing, legibility next to the caveat text, mobile width).
