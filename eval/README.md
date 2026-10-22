# Comps eval gates

The purpose of this folder is to make "done" mean something stronger than "the answer looked good once."

`expectations.json` declares the budgets/invariants.  
`cases.json` names the behaviors that must be exercised.

This is intentionally lighter than Lumina's course-provided grader, but it uses the same idea: **prove the trajectory and the system boundaries, not only the final prose.**

## Gate 0 — static

Run:

```bash
npm run lint
npm run build
git status --short
```

Fail if:
- lint/build fails
- secrets are staged/tracked
- an unexpected file changed without explanation

## Gate 1 — tool-level Step 2 checks

Use existing scripts:

```bash
npx tsx --env-file=.env.local scripts/try-lookup.ts
npx tsx --env-file=.env.local scripts/try-financials.ts
npx tsx --env-file=.env.local scripts/try-calc.ts
npx tsx --env-file=.env.local scripts/try-tools.ts
```

Check:
- ticker behavior
- fiscal-year normalization
- calculator safety
- timeout/retry
- fake citation removal

## Gate 2 — agent smoke

Development/Haiku:

```bash
npx tsx --env-file=.env.local scripts/try-agent.ts \
  "Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years"
```

Read the **full trace**.

A pass is not only "kind=answer." Confirm:
- the lookup/fetch/calculate sequence made sense
- no tool thrashed
- citations came from retrieved sources
- the loop finished within 6 iterations
- missing data was not invented

## Gate 3 — edge cases

Run the existing edge/injection scripts and map results to `cases.json`.

```bash
npx tsx --env-file=.env.local scripts/try-edge.ts
npx tsx --env-file=.env.local scripts/try-injection.ts
```

Do not rewrite expected behavior merely because the current model returned something else.

## Gate 4 — usage/API boundary

After Step 3, verify:
- free 0/1/2 successes allowed
- free 3 successes denied before model spend
- failed/non-answer rows ignored
- Pro 24 today allowed
- Pro 25 today denied
- reset is next UTC midnight
- logged-out ask is denied

Prefer tests/scripts that seed isolated test users/rows or mock the query boundary. Avoid burning LLM calls for usage math tests.

## Gate 5 — Stripe boundary

Verify locally where possible and in Stripe test mode for the full path:
- authenticated checkout only
- server-known user id in metadata
- already-Pro safe behavior
- invalid webhook signature cannot update plan
- completed event updates plan
- replay is idempotent
- cancelled checkout changes nothing

The success redirect is never accepted as proof of payment.

## Gate 6 — browser integration

Use the real browser while logged in.

Confirm:
- trace events visibly arrive before final answer
- answer tables/sources render
- run appears in Supabase
- usage display updates
- free limit renders as upgrade state
- checkout returns cleanly
- plan persists across reload/login
- no console errors

## Gate 7 — Sonnet/live demo gate

On the deployed Railway URL with the demo model:
1. run the primary 3-company question
2. record wall-clock time
3. run one edge case
4. complete one test-mode upgrade
5. ask again post-upgrade

Target primary answer: roughly under 60 seconds as defined by the PRD/demo criterion.

If it is slower:
- do not fake the measurement
- inspect trace for excess iterations/tool calls
- record actual latency in BIG_AUDIT
- choose a stable demo query only after correctness remains intact

## Human trajectory review

Before freeze, manually read:
- one successful primary run
- one failure/non-answer run

For each, answer:
- Was each tool call justified?
- Did errors surface honestly?
- Did the run stop because it had an answer, not because it silently failed?
- Can every displayed financial figure be traced to retrieved data?
- Is there any point where the model appears to have used unsupported memory?

Record the run/question names in `BIG_AUDIT.md`.

## Suggested future automation

If time permits, add `scripts/run-evals.ts` that reads `eval/cases.json` and produces `eval/report.json`.

Do this only after Step 3 is working. The capstone does not need a large testing framework more than it needs a verified product.
