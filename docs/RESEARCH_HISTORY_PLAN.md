# Research History Plan — Comps

> **Goal:** Add a lightweight, useful research-history experience using the existing Supabase `runs` table and the structured result already persisted by Step 2.
>
> **Non-goal:** Do not introduce MongoDB, a new database, a new history schema, conversation threading, folders, bookmarks, or collaborative workspaces in this pass.

---

# 1. Why this feature

Comps already persists every run with:

- user id
- question
- answer text
- structured trace
- status
- creation time

The `trace` JSON already stores both:
- the ordered agent steps
- the structured final answer

That means the backend data needed for a first useful History feature already exists.

The feature should turn Comps from:

> ask → answer → leave

into:

> ask → save automatically → return later → reopen the full research result

This is a meaningful analyst workflow improvement with very low architectural risk.

---

# 2. Scope

## In scope

Build:

1. a History entry in the authenticated navigation
2. a `/history` page
3. a list of the current user's past runs
4. newest-first ordering
5. clear grouping by date/time
6. question preview
7. run status
8. click-through to a saved research result
9. a saved-result detail page
10. reuse of the current answer renderer for saved structured answers
11. empty state
12. loading/error states
13. responsive behavior
14. RLS-safe/user-scoped access

## Out of scope

Do not build:

- MongoDB
- new database cluster
- new run-history table
- folders
- favorites
- tags
- renaming history items
- deleting history
- search across history
- multi-turn conversation threading
- shared team history
- exporting from history
- semantic search
- vector embeddings

These can be future features.

---

# 3. Existing data model

Use the existing Supabase `runs` table.

Conceptually, each row contains:

```text
id
user_id
question
answer
trace
status
created_at
```

The important field is `trace`.

Current Step 2 persistence stores:

```ts
trace: {
  steps: TraceStep[],
  answer: FinalAnswer
}
```

Therefore the saved history page should not reconstruct answers from prose.

It should read:

```ts
run.trace.answer
```

and pass that saved `FinalAnswer` into the existing answer-rendering components.

Similarly, `run.trace.steps` can be shown as the saved research trace.

---

# 4. Architectural rules

## HIST-001 — Supabase only

Use the existing Supabase Postgres database.

Do not add MongoDB.

## HIST-002 — Existing runs table

Do not introduce a new history table unless a real blocking limitation is discovered.

History is a read-side view over persisted runs.

## HIST-003 — User isolation

A user must only be able to read their own runs.

Use the existing RLS/user-scoped access model.

Never accept an arbitrary `user_id` from the browser and query history as that user.

## HIST-004 — Structured answer reuse

Saved runs should render from the persisted structured `FinalAnswer` in `trace.answer`.

Do not parse the stored `answer` markdown back into structured data.

## HIST-005 — No agent rerun

Opening a history item must not:
- call Claude
- call SEC
- call Tavily
- consume usage
- create a new run

It is a pure read operation.

## HIST-006 — Failed/non-answer runs

Recommended v1:
- show successful research prominently
- show non-success runs with a muted status label
- never make failed runs look like successful research

Do not silently hide non-success runs unless that product decision is explicitly documented.

## HIST-007 — Existing UI system

Use the current Perplexity/Fintool-style design system.

Do not create a separate visual language.

---

# 5. Navigation

Add `History` to the authenticated sidebar.

Suggested placement:

```text
New question
History
Pricing
```

Use the existing icon system and active-route styling.

Do not add History to auth pages.

---

# 6. `/history` page

Desktop concept:

```text
History

Your recent research

Today
──────────────────────────────────────────────

Compare Nike, Lululemon and Under Armour's...
Answer · 10:28 PM                              →

Why did VF Corp's operating margin decline?
Answer · 9:11 PM                               →

Yesterday
──────────────────────────────────────────────

How has Deckers' revenue grown since 2020?
Answer · 6:32 PM                               →
```

Properties:

- same app shell
- same dark research visual system
- newest first
- compact rows
- subtle separators
- question is dominant
- timestamp/status is secondary
- no oversized dashboard cards

---

# 7. History row

Each row should include:

- question
- date/time
- status/kind where useful
- optional compact metadata
- chevron/arrow

Example:

```text
Compare Nike and Lululemon's margins over 5 years
Answer · Today, 10:28 PM                                  →
```

Optional metadata, only if cheap to derive:

```text
4 research steps · 9 sources
```

Do not make rows visually noisy.

---

# 8. Date grouping

Recommended groups:

- Today
- Yesterday
- Earlier

or:

- Today
- Yesterday
- This week
- Older

Use a small local helper.

Do not add a date library only for this.

Ordering remains `created_at DESC`.

---

# 9. Detail route

Recommended:

```text
/history/[id]
```

The detail page reopens the saved research result.

Structure:

```text
History / Research

Compare Nike, Lululemon and Under Armour...

Asked Oct 19, 2026 · 10:28 PM

▸ Researched in 4 steps

[Saved answer]

[Tables]

[Notes]

[Sources]
```

Important:

- no live "Researching" state
- no Claude call
- no SEC call
- no Tavily call
- no usage consumption
- no new `runs` row

---

# 10. Reuse current answer UI

Do not duplicate answer rendering.

Reuse the existing components responsible for:

- answer prose
- structured tables
- citation markers
- notes
- sources
- non-answer presentation

If `AnswerView` requires live-query callbacks:
- make callbacks optional, or
- add a small adapter

Do not copy the entire component into a new history-specific answer renderer.

---

# 11. Saved trace

Reuse the current trace component if practical.

Saved state should appear completed:

```text
▸ Researched in 4 steps
```

When expanded:
- show saved Thought/Action/Observation rows
- no spinner
- no active/running state

If existing `AgentTrace` already supports `loading=false`, reuse it unchanged.

---

# 12. Follow-ups from history

Optional for this first pass.

If saved follow-up questions are shown, clicking one should start a **new** research request through the existing ask flow.

Preferred:
- navigate to `/` with the question prefilled or submitted

Do not make follow-ups execute the agent directly inside the history page unless the current architecture already makes that trivial.

If this introduces meaningful complexity, hide saved follow-up controls for v1 rather than blocking History.

---

# 13. Data access

Prefer server-side loading where it matches the existing Next.js architecture.

## History list

Fetch only the current authenticated user's recent runs, newest first.

Retrieve only fields needed for the list.

Recommended limit:

```text
50 most recent runs
```

No infinite scroll is required.

## History detail

Fetch one run by:
- run id
- current authenticated user ownership

If not found or owned by another user:
- return a safe not-found state
- do not disclose another user's data

---

# 14. Type safety

Create or reuse a type such as:

```ts
type PersistedRunTrace = {
  steps: TraceStep[];
  answer: FinalAnswer;
};
```

Avoid `any` for the whole payload.

Because old development rows may have different shapes, include a runtime guard/fallback.

If `trace.answer` is malformed or missing:

1. fall back to stored `answer` text
2. do not crash
3. do not run the agent again

---

# 15. Empty state

If no runs exist:

```text
No research yet

Your completed Comps research will appear here automatically.

[ Start researching ]
```

This is not an error state.

---

# 16. Error states

History list:

```text
We couldn't load your research history.

[ Try again ]
```

Detail:

```text
Research not found

This research may no longer be available.
```

Never expose raw Supabase errors to the browser.

---

# 17. Responsive behavior

Desktop:
- compact rows
- width consistent with current research workspace

Mobile:
- question wraps
- timestamp/status can move below it
- full row remains clickable
- no horizontal overflow
- current mobile navigation behavior remains intact

---

# 18. Security

Verify:

- history requires authentication
- RLS remains enabled
- users can only read their own rows
- no service/admin key is exposed to the browser
- guessing another run ID cannot bypass ownership checks
- no RLS policy is weakened merely to simplify the feature

---

# 19. Performance

For the capstone:

- fetch the most recent 50 history rows
- do not load unbounded history
- do not add a caching subsystem
- do not add pagination unless genuinely necessary

---

# 20. Suggested component structure

Adapt to the actual repo.

Conceptually:

```text
app/
  history/
    page.tsx
    [id]/
      page.tsx

components/
  history/
    history-list.tsx
    history-row.tsx
    history-empty.tsx
```

Reuse existing:

```text
components/
  answer-view
  agent-trace
  layout/app-shell
```

Do not create files that add no meaningful abstraction.

---

# 21. Status labels

Map saved run/answer state conservatively.

Examples:

```text
success + answer          → Answer
failed + declined         → Declined
failed + clarification    → Clarification
failed + not_covered      → Not covered
failed + off_topic        → Off topic
failed + insufficient_data → Incomplete
failed + error            → Error
```

Use `trace.answer.kind` when available.

Do not reduce every non-success row to a generic "Failed" label if a more useful saved kind exists.

---

# 22. Compatibility with old rows

Guard against:

- `trace = null`
- array-only trace
- missing `trace.answer`
- malformed JSON

Fallback:

1. structured answer if valid
2. stored answer text if not
3. never crash

Do not add a migration only to normalize old development rows.

---

# 23. Tests

## Static

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Data/access

Verify:

1. logged-out user cannot open history
2. logged-in user sees own runs
3. newest first
4. another user's run cannot be opened
5. opening history creates no run
6. opening history calls no agent
7. opening history consumes no usage

## Rendering

Verify:

1. saved successful answer
2. tables
3. citations/source links
4. notes
5. completed trace
6. failed/non-answer run
7. malformed/legacy trace fallback
8. empty history

## Browser

Desktop + mobile:

- History nav works
- active nav state works
- list row click works
- detail opens
- browser back works
- no console errors
- no horizontal overflow
- source links remain safe
- New Question still works
- Pricing still works

---

# 24. Regression constraints

Do not modify unless a real bug is discovered:

- ReAct loop
- prompts
- tools
- SEC normalization
- citation grounding
- Stripe
- usage limits
- checkout
- NDJSON streaming
- database schema

This should be overwhelmingly a **read-side feature**.

---

# 25. BIG_AUDIT update

Append a new entry containing:

- feature added
- files changed
- whether a migration was needed
- auth/RLS checks
- browser checks
- static checks
- bugs found/fixed
- deviations
- remaining risks

Do not rewrite previous audit history.

---

# 26. Definition of done

- [ ] History appears in authenticated navigation
- [ ] `/history` requires login
- [ ] current user's recent runs appear newest first
- [ ] empty state works
- [ ] clicking a run opens saved research
- [ ] saved structured answer reuses existing renderer
- [ ] saved trace renders completed
- [ ] source links work
- [ ] non-answer/failed rows render safely
- [ ] malformed legacy data cannot crash the page
- [ ] another user's run cannot be accessed
- [ ] opening history does not call the agent
- [ ] opening history does not consume usage
- [ ] no MongoDB/new database is introduced
- [ ] no unnecessary migration is introduced
- [ ] lint passes
- [ ] typecheck passes
- [ ] build passes
- [ ] browser checks pass
- [ ] BIG_AUDIT is updated

---

# 27. Future extensions

This creates a foundation for later:

- history search
- bookmarks/favorites
- folders
- saved peer groups
- research notes
- exports
- report generation
- shared team research
- threaded research sessions

Do not build these in this pass.
