# Step 4 execution plan — frontend polish, browser QA, demo reliability

Owners: Forum + Reyn, with agent/backend owners fixing only confirmed backend bugs.  
Goal: make the existing behavior clear, resilient, and demo-ready without changing the architecture.

## 0. Read first

- `CLAUDE.md`
- `docs/PRD.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/BIG_AUDIT.md`
- `docs/step2-plan.md` sections on streaming/UI
- `docs/step3-plan.md` UI contracts
- `eval/cases.json`

Before edits:
- run lint/build
- use the live app once
- identify current browser-console errors
- capture current main-flow screenshots

## Non-goal

Step 4 is **not** a reason to rewrite:
- the agent loop
- financial normalization
- citation registry
- tool schemas
- Stripe entitlement semantics

If UI work exposes a real backend bug, isolate it with a failing case and make the smallest backend fix.

---

## Component 1 — page hierarchy and ask state

Main page should make these states visually distinct:

1. empty / ready
2. submitting
3. researching with live trace
4. final answer
5. non-answer / clarification
6. usage-limit state
7. recoverable request error

The user should never wonder whether the app is still working.

Keep example questions visible in the empty state.

---

## Component 2 — trace experience

Requirements:
- new steps appear while the request is running
- current action visibly looks in-progress until its observation arrives
- completed actions show success/failure state
- trace is open during work
- trace can collapse after final answer
- final collapsed label summarizes how much research occurred

Avoid exposing raw giant JSON payloads in normal UI.

A tool failure should appear as a failed observation, not vanish.

---

## Component 3 — final answer

For `kind = answer`:
- takeaway first
- structured table(s)
- source markers
- notes/caveats
- source list
- exactly the provided follow-up questions
- "Figures from SEC filings. Not investment advice."

Tables:
- horizontally scroll on narrow screens
- preserve labels and period-end dates
- do not truncate fiscal-year distinctions

Sources:
- markers navigate to source entry
- links open safely in a new tab
- no broken source created from an unknown citation key

---

## Component 4 — non-answer states

Design neutral, specific treatments for:
- clarification
- not covered
- declined
- off topic
- insufficient data

Do not present these as system crashes.

For clarification, follow-up buttons should make it easy to rerun with the selected company.

For declined investment advice, offer a fundamentals alternative.

---

## Component 5 — plan/usage UI

Show current plan and remaining questions.

Free examples:
- `Free · 3 of 3 left`
- `Free · 1 of 3 left`

Pro:
- `Pro · 23 of 25 left today`

When free allowance is exhausted:
- show upgrade CTA
- preserve the user's question if practical so they can ask it after upgrading

When Pro daily cap is hit:
- show reset time
- do not suggest buying Pro again

After a successful run, refresh usage display from authoritative server/profile/run state.

---

## Component 6 — pricing / checkout UX

States:
- Free CTA
- creating checkout session
- Stripe redirect
- cancelled
- confirming completed upgrade
- Pro

Never flip the UI permanently to Pro solely because `?success=true` is in the URL.

---

## Component 7 — accessibility and responsive QA

Minimum:
- form controls have accessible labels
- keyboard submit works
- buttons have disabled/loading states
- source links are keyboard reachable
- focus behavior after errors is reasonable
- text/table contrast is readable
- mobile/narrow viewport does not make tables unusable
- no important information depends only on color

---

## Component 8 — browser integration matrix

Run on the actual app, not only scripts:

1. sign up / log in
2. primary 3-company benchmark
3. watch trace stream
4. click filing citation
5. click follow-up
6. typo case
7. ambiguous case
8. not-covered case
9. declined case
10. off-topic case
11. free limit
12. upgrade
13. post-upgrade question
14. cancelled checkout
15. refresh/reload during normal idle state
16. browser back after Stripe
17. logout/login and verify plan persists

Check:
- no console errors
- no hydration errors
- no unhandled promise rejections
- no raw server exception text

---

## Component 9 — demo questions

Pick only questions that have been verified on:
- Sonnet
- live Railway
- current SEC data
- current UI

Recommended candidates from the existing build:
- Nike vs Lululemon vs Under Armour gross margin, 5 years
- Deckers revenue + operating income growth
- Skechers vs Nike inventory + operating cash flow
- VF Corp margins over 5 years

Choose 3–4 final questions and record:
- expected result
- normal latency
- known missing-data caveats
- number of steps/sources

Keep one edge case ready: Adidas / not covered.

---

## Component 10 — final Step 4 gate

- [ ] Full main journey works on live URL.
- [ ] Trace visibly streams.
- [ ] Answer tables/citations render correctly.
- [ ] Usage badge is accurate after runs.
- [ ] Free limit gives upgrade CTA.
- [ ] Pro cap gives reset message.
- [ ] Pricing reflects authoritative plan.
- [ ] No console errors in main flow.
- [ ] Mobile/narrow viewport is usable.
- [ ] 3–4 demo questions are verified on Sonnet/live.
- [ ] One edge case is verified.
- [ ] README architecture diagram/live link are current.
- [ ] BIG_AUDIT is updated.
