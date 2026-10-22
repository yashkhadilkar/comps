# THREADS_CONTINUATION_PLAN.md — Comps

> **Goal:** Upgrade Comps from one-shot saved research runs into proper multi-turn research threads, while preserving the current Step 2 agent, Step 3 usage/Stripe behavior, and existing research-history UI.
>
> **Primary outcome:** A user can open a previous research thread, ask a follow-up, and the agent receives bounded conversational context while still re-fetching any evidence it cites.
>
> **Important:** This is an architectural upgrade, not a chatbot rewrite.

---

# 1. Product objective

Today, Comps history behaves like an archive:

```text
ask question
→ get answer
→ save run
→ reopen later
```

After this feature, Comps should support:

```text
ask question
→ get answer
→ continue research
→ ask follow-up
→ agent understands prior context
→ new answer saved into same thread
→ reopen the full thread later
```

This should feel like an analyst research workspace rather than a collection of isolated prompts.

---

# 2. Core design

Use two concepts:

```text
threads
  one row per research conversation

runs
  one row per user question / agent answer
```

Recommended relationship:

```text
threads 1 ──── * runs
```

Each thread belongs to one user.
Each run belongs to one thread and one user.

---

# 3. Proposed schema

## 3.1 `threads`

Create a new table:

```sql
create table threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Recommended index:

```sql
create index threads_user_updated_idx
on threads (user_id, updated_at desc);
```

## 3.2 `runs`

Add:

```sql
alter table runs
add column thread_id uuid references threads(id) on delete cascade;
```

Recommended index:

```sql
create index runs_thread_created_idx
on runs (thread_id, created_at asc);
```

Do not remove:
- `user_id`
- `question`
- `answer`
- `trace`
- `status`
- `created_at`

Keeping `user_id` on `runs` is useful for:
- current usage counting
- direct ownership checks
- existing Step 3 behavior

---

# 4. Backfill existing history

Existing runs predate threads.

Recommended migration strategy:

For each existing run:
- create one thread owned by that run's `user_id`
- use the run's question as the initial thread title
- set thread `created_at` and `updated_at` to the run's `created_at`
- set the run's `thread_id` to the newly created thread

This preserves all existing history with one run per initial thread.

Do not try to infer which old runs belong together.

That would add ambiguity for no real value.

---

# 5. RLS

## 5.1 Threads

Enable RLS:

```sql
alter table threads enable row level security;
```

Policies:

```sql
create policy "Users can view own threads"
on threads
for select
to authenticated
using (auth.uid() = user_id);
```

```sql
create policy "Users can insert own threads"
on threads
for insert
to authenticated
with check (auth.uid() = user_id);
```

```sql
create policy "Users can update own threads"
on threads
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Do not add delete yet unless the product explicitly needs thread deletion.

## 5.2 Runs

Existing policies should remain.

If current run inserts already work correctly, do not rewrite the policy set unnecessarily.

If selecting runs by thread requires no new policy because existing `user_id = auth.uid()` access already covers it, leave it alone.

---

# 6. Ownership invariant

The server must never trust a browser-supplied `thread_id` by itself.

When continuing a thread:

1. authenticate user
2. load the thread by:
   - `thread.id`
   - `thread.user_id = authenticated user`
3. only then load its runs
4. only then pass context to the agent

A user must not be able to continue another user's thread by editing a URL or request body.

---

# 7. Thread lifecycle

## New research

User starts from `/` with no thread.

Flow:

```text
user submits question
→ server authenticates
→ create thread
→ title = question (trimmed)
→ run agent
→ save run with thread_id
→ update thread.updated_at
```

Important:
- thread creation must happen exactly once for the new conversation
- the first run belongs to that thread

## Continued research

User opens an existing thread and asks a follow-up.

Flow:

```text
load owned thread
→ load bounded prior runs
→ build conversation context
→ submit current question
→ run agent normally
→ save new run with same thread_id
→ update thread.updated_at
```

---

# 8. Thread title

For v1:

Use the first question as the title.

Recommended helper:

```ts
title = question.trim().slice(0, 120)
```

No LLM title generation.

No background title rewrite.

No extra model spend.

Later, thread rename can be added manually.

---

# 9. History model changes

Current History likely lists runs.

Change History to list **threads**.

Each row should represent one research conversation.

Example:

```text
History

Today
────────────────────────────────────

Compare Nike, Lululemon and Under Armour...
3 questions · 10:42 PM                       →

Why did VF Corp's margin collapse?
5 questions · 9:18 PM                        →
```

Recommended row metadata:
- title
- updated time
- number of runs/questions

History ordering:

```text
updated_at desc
```

Not `created_at`.

A continued thread should rise to the top.

---

# 10. Thread detail page

Recommended route:

```text
/history/[threadId]
```

Render all saved runs oldest → newest.

Structure:

```text
Compare Nike and Lululemon's margins...

User question 1
[answer 1]

User question 2
[answer 2]

User question 3
[answer 3]

────────────────────────────

[ Ask a follow-up... ]
```

Do not use generic chat bubbles if that conflicts with current research-document UI.

Prefer research sections per turn.

---

# 11. Continue research UX

At the bottom of a thread page:

```text
Continue this research

[ Ask a follow-up about this thread...           ]
```

Submitting should:
- use the same `thread_id`
- append a new run
- stream trace + answer normally
- update the page

The user should not need to navigate back to `/`.

Preferred experience:
- ask follow-up directly inside `/history/[threadId]`

Acceptable fallback:
- navigate to `/?thread=<id>`

But direct continuation in the thread page is better.

---

# 12. Conversation context

This is the most important agent change.

The agent should receive:
- bounded previous user questions
- bounded previous assistant answers
- current new user question

It should NOT receive:
- raw previous tool outputs as trusted evidence
- previous citations as current evidence
- huge historical traces
- all tool observations from every previous run

---

# 13. Grounding rule

Previous answers are **context**, not evidence.

The system prompt or context wrapper must explicitly state:

> Prior turns are conversational context only. Do not treat figures, citations, or claims from prior answers as current evidence. Re-fetch any financial or news data needed for the new answer using the tools.

This prevents:
- stale data reuse
- citation leakage
- compounding hallucinations
- treating model output as authoritative

This rule should be tested.

---

# 14. Context shape

Recommended conversion from saved runs:

```ts
[
  {
    role: "user",
    content: previousRun.question
  },
  {
    role: "assistant",
    content: summarizePriorAnswer(previousRun.trace.answer)
  },
  ...
]
```

Then append:

```ts
{
  role: "user",
  content: currentQuestion
}
```

Do not pass the full saved trace.

---

# 15. Assistant-history content

Use compact structured answer context.

Recommended content:

```text
Takeaway:
<answerMarkdown>

Important notes:
<notes>

Companies/metrics already discussed:
<optional compact extraction>
```

Do not include:
- all source URLs
- giant tables verbatim unless needed
- every trace step
- tool JSON

The goal is reference resolution, not rehydrating evidence.

---

# 16. Context bounding

Do not load the entire thread forever.

Recommended v1 bound:

```text
last 3 completed runs
```

That gives at most roughly:
- 3 prior user turns
- 3 prior assistant turns
- current question

If a thread has more than 3 prior runs:
- only load the latest 3 for model context
- still render the full thread in the UI

This keeps:
- latency predictable
- prompt cost controlled
- context manageable

Document the bound as a deliberate capstone tradeoff.

---

# 17. Context truncation

Within each assistant answer:
- prefer the main answer prose
- optionally include concise notes
- exclude long sources list
- exclude trace
- exclude repeated tables if very large

Recommended max per prior assistant turn:
- ~2500 characters

Recommended max prior user question:
- ~1000 characters

Use deterministic truncation.
Do not spend another model call summarizing history.

---

# 18. Ambiguous references

A continued thread should allow questions like:

```text
Which of these companies improved the most?
```

```text
Why did that margin decline?
```

```text
Is that visible in cash flow too?
```

The prior context should make "these companies", "that margin", and "that" understandable.

But if the reference is genuinely ambiguous, the existing clarification machinery should still be allowed to trigger.

Do not bypass clarification logic just because a thread exists.

---

# 19. Agent API contract

Extend the current ask flow minimally.

Recommended request:

```ts
{
  question: string;
  threadId?: string;
}
```

No arbitrary prior messages from the browser.

The server should derive conversation history itself from `threadId`.

Do not let the client send the entire conversation transcript as trusted context.

This avoids:
- tampering
- cross-user context injection
- oversized requests
- stale browser state

---

# 20. Route behavior

Recommended order for `/api/agent`:

```text
1. authenticate
2. validate question
3. validate/load thread if threadId supplied
4. check usage
5. load bounded prior context
6. start agent
7. persist run with thread_id
8. update thread.updated_at
```

For a new conversation:
- create thread before persistence needs it
- ensure failed runs still attach to the thread if that matches current product behavior

Do not change:
- NDJSON event format
- agent trace contract
- final answer contract
- citation verification

---

# 21. New-thread creation timing

Recommended:

Create the thread after:
- auth
- input validation
- usage allowed

but before:
- agent execution

This avoids creating empty threads for:
- logged-out requests
- invalid questions
- users already over quota

If the agent fails, the thread may contain one failed run.
That is acceptable and honest.

---

# 22. Persistence

When saving a run, include:

```text
thread_id
```

Do not change usage counting.

Usage still counts:
- successful `runs`
- exactly as Step 3 currently does

This is important.

One thread with 5 successful questions should count as 5 successful runs.

Do not count threads for quota.

---

# 23. Thread `updated_at`

Whenever a run is saved into a thread:

```text
threads.updated_at = now()
```

Best-effort behavior is acceptable if the run save succeeds and the timestamp update fails, but log it.

History order depends on this field.

---

# 24. Research history redesign

Change the history data layer from:

```text
recent runs
```

to:

```text
recent threads
```

For each thread, fetch:
- id
- title
- updated_at
- created_at
- run count

Optional:
- latest run kind/status

Avoid loading every full trace just to render the list.

---

# 25. Thread detail query

Load:
- thread metadata
- its runs
- oldest first

Recommended fields:
- id
- question
- answer
- trace
- status
- created_at

Do not load other users' data.

---

# 26. Reuse current rendering

Each run should continue to use:
- `AnswerView`
- `AgentTrace`

If the current History detail page already renders one saved run well, generalize it to render a list of runs.

Do not duplicate the answer renderer.

---

# 27. Live follow-up streaming

For a follow-up submitted inside a thread:

Expected UI:

```text
existing saved turns

new question
Researching...
[stream trace]
[final answer]
```

When complete:
- it becomes another saved turn
- no full page refresh should be required if avoidable

If the simplest safe implementation uses router refresh after completion, that is acceptable for v1.

Correctness over fancy client state.

---

# 28. Thread state after refresh

Refreshing `/history/[threadId]` must reconstruct the whole conversation from Supabase.

No dependence on in-memory client state.

---

# 29. New Question behavior

Sidebar `New question` must start a new thread.

It must not accidentally keep the previous `threadId`.

Verify:
- navigate from thread to New Question
- ask
- a different thread is created

---

# 30. Follow-up buttons

Existing generated follow-ups can now be more useful.

Inside a thread:
- clicking a follow-up should submit it into the same thread

Outside a thread/new standalone result:
- it should continue the just-created thread

This should feel continuous.

Do not create a new thread for every follow-up.

---

# 31. Security

Verify:

- authenticated user can only list own threads
- authenticated user can only load own thread
- authenticated user can only continue own thread
- guessed thread id from another user returns not found/unauthorized safely
- browser cannot inject prior conversation
- browser cannot specify another user id
- service key never exposed client-side

---

# 32. Migration execution

Because Yash has Supabase access:

Claude should:
1. write a migration file
2. show the exact SQL
3. stop before assuming it has been applied
4. ask the user to have Yash apply it
5. once confirmed, continue implementation/testing

Do not silently code against an unapplied schema.

Recommended migration filename:

```text
supabase/migrations/<timestamp>_add_threads.sql
```

Use the project's existing migration naming convention.

---

# 33. Backfill SQL

Claude should generate safe SQL that:
- creates one thread per existing run
- associates each run to its thread
- preserves user ownership
- preserves timestamps

Backfill must be deterministic.

After backfill:
- every existing run should have `thread_id`

If practical after backfill, make `runs.thread_id` `NOT NULL`.

If that adds migration complexity/risk, leave it nullable for v1 and enforce in application code.

Prefer reliability over schema perfection this week.

---

# 34. Failure handling

## Invalid thread

Return a safe error before starting the agent.

## Thread belongs to someone else

Return not found or equivalent.
Do not reveal ownership information.

## History load fails

Show clean UI error.

## Context load partially fails

Do not continue with potentially wrong partial ownership context.
Fail safely.

---

# 35. Usage behavior

Existing Step 3 usage must remain unchanged.

Explicit tests:

### Free
- 2 successful runs across one thread → used = 2
- 1 additional successful follow-up → used = 3
- next follow-up denied

### Pro
- 24 successful runs across any number of threads → one more allowed
- 25 → blocked

Thread grouping must never alter quota semantics.

---

# 36. Grounding tests

Add tests for:

### Context understanding

Prior:
```text
Compare Nike and Lululemon margins.
```

Follow-up:
```text
Which of these companies improved more?
```

The model should understand the companies.

### Evidence isolation

Prior answer contains:
```text
Nike gross margin was 45.9%.
```

Follow-up:
```text
Why did it change?
```

The new run must retrieve evidence again before citing a figure.

Test goal:
- prior answer alone must not populate current citations
- current final citations must come from current tool registry

### Stale-data protection

If previous answer contains an old figure that differs from newly fetched tool output:
- new tool output wins

---

# 37. Context token tests

Verify:
- only last 3 prior runs loaded
- older thread turns not sent to model
- assistant answer truncation works
- sources/trace are excluded from context
- long thread still runs within acceptable latency

---

# 38. UI states

## History list

Show:
- thread title
- last updated
- run/question count

## Thread detail

Show:
- thread title
- saved turns
- timestamps
- completed traces
- citations
- bottom follow-up composer

## Empty

History empty state remains.

---

# 39. Responsive behavior

Desktop:
- research thread flows vertically
- composer sticky or docked as current design supports

Mobile:
- turn sections wrap
- financial tables scroll internally
- composer does not cover last answer
- no horizontal page overflow

---

# 40. Suggested file impact

Claude must inspect actual repo before deciding.

Likely areas:

```text
supabase/migrations/*
lib/history.ts
lib/agent/*
app/api/agent/route.ts
app/history/page.tsx
app/history/[id]/page.tsx
components/history/*
components/ask-form.tsx
components/answer-view.tsx
```

Potentially:
- shared types for thread/run payloads

Do not create unnecessary files.

---

# 41. Tests

## Static

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Migration

Verify:
- threads table exists
- indexes exist
- RLS enabled
- existing runs backfilled
- no orphaned runs unexpectedly created
- users cannot see other users' threads

## New thread

Verify:
- first question creates one thread
- run attaches to thread
- history shows one thread

## Continue

Verify:
- follow-up uses same thread
- second run attaches to same thread
- thread updated_at changes
- history still shows one row for conversation
- run count increases

## Context

Verify:
- prior turn context loaded
- latest 3 only
- current answer re-fetches evidence
- previous citations not trusted

## Usage

Verify:
- successful follow-up increments current run usage normally
- failed/non-answer behavior remains per current Step 3 rules
- thread count is irrelevant to usage

## Security

Verify:
- other user's thread cannot be opened
- other user's thread cannot be continued
- client cannot forge conversation history

## Browser

Verify:
- New Question → creates new thread
- History → thread list
- open thread
- continue thread
- stream works
- refresh restores conversation
- follow-up chips stay in same thread
- mobile
- no console errors

---

# 42. Regression constraints

Do not change unless a proven bug requires it:

- SEC period normalization
- tool behavior
- calculator
- citation registry
- structured final answer schema
- iteration limits
- tool retry semantics
- Stripe checkout
- webhook
- pricing
- usage-count rules
- existing RLS unrelated to threads

---

# 43. Documentation updates

Update:

## DESIGN.md

Document:
- threads vs runs
- ownership model
- context bounding
- prior-context-not-evidence rule

## ARCHITECTURE.md

Update:
- data model
- request flow
- history/thread lifecycle

## SPEC.md

Add requirements for:
- thread ownership
- continuation
- context bound
- grounding isolation
- usage independence

## BIG_AUDIT.md

Append:
- migration
- files changed
- tests
- deviations
- known risks

Do not rewrite historical entries.

---

# 44. Definition of done

- [ ] `threads` table exists
- [ ] `runs.thread_id` exists
- [ ] existing runs are backfilled
- [ ] RLS protects threads
- [ ] new research creates a thread
- [ ] follow-up reuses same thread
- [ ] History lists threads, not runs
- [ ] continued thread rises to top
- [ ] thread detail renders all runs
- [ ] follow-up can be asked from thread page
- [ ] current stream behavior remains intact
- [ ] prior turns are bounded
- [ ] prior answers are treated only as context
- [ ] figures/citations are re-grounded on each new run
- [ ] usage still counts successful runs
- [ ] New Question creates a separate thread
- [ ] refresh reconstructs thread from Supabase
- [ ] cross-user access blocked
- [ ] lint passes
- [ ] typecheck passes
- [ ] build passes
- [ ] browser flow passes
- [ ] docs updated
- [ ] BIG_AUDIT updated

---

# 45. Future extensions

Do not build these now:

- thread deletion
- thread rename UI
- pin/favorite
- folders
- collaborative threads
- thread sharing
- automated summaries
- semantic thread search
- long-term memory across threads

The goal now is proper multi-turn research continuity.
