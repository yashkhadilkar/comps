# Step 5 plan — freeze, write-up, slides, demo, rehearsal

Goal: convert the verified build into a clear 7-minute capstone story without destabilizing it.

## 0. Freeze rule

Once Step 4 handoff is green:
- feature freeze
- only demo-blocking or correctness defects may change code
- every post-freeze code change must rerun the primary demo path and relevant eval case
- do not "clean up" stable agent code for aesthetics

Tag or record the exact commit used for the demo.

## 1. Evidence pack

Capture:
- architecture diagram
- main empty state
- live trace in progress
- final cited comparison
- source/citation view
- free-limit upgrade state
- Stripe test checkout
- Pro state after webhook
- one clean edge case

Record:
- live URL
- commit SHA
- model used
- normal primary-demo latency
- date/time of last successful full rehearsal

## 2. Write-up structure (4–5 pages)

### 1. Problem and users
Use the PRD problem:
- manual benchmarking is slow
- generic chatbots are unreliable on figures
- pro tools are expensive
- users are long-term investors and in-house analysts

### 2. Solution and architecture
Show:
- one Next.js/Railway service
- Supabase
- ReAct agent
- Claude
- SEC EDGAR
- Tavily
- Stripe

Explain 2–4 choices, not every box.

### 3. AI design
Cover:
- why ReAct instead of one-shot/RAG
- the 4 tools
- bounded loop
- parallel tool calls
- structured final answer
- server-verified citations
- calculator tool
- untrusted news handling

### 4. Reliability / edge cases
Use evidence from `BIG_AUDIT.md`:
- typo resolution
- ambiguity
- non-SEC company
- missing fiscal year
- tool timeout
- prompt injection attempt
- fabricated citation removal
- buy/sell decline

### 5. Lessons and next steps
Use real build incidents, not generic claims:
- SEC `fy` does not mean what it first looks like
- companies change XBRL tags
- output schemas/prompt wording matter
- production would add persistent caching, rate limiting, monitoring, broader data

## 3. Slides

Target ~7 minutes, minimal text.

Recommended flow:
1. problem/users
2. system architecture
3. agent/tool loop
4. live demo
5. trust/reliability
6. lessons + next steps

Every speaker should be able to say exactly what they built.

## 4. Demo script

Prepare the demo account so it is in the state needed for the story.

Primary demo:
1. open live URL already logged in
2. ask primary benchmark
3. while trace streams, explain tools
4. point at cited answer and fiscal-year labels
5. show one edge case
6. hit free limit
7. open upgrade
8. test Stripe checkout
9. show Pro
10. ask again or show entitlement working

Keep the script shorter than the available time; agent latency is variable.

## 5. Backup demo

Record a clean backup video on the exact demo commit.

Keep it accessible offline or in a place the presenting laptop can open quickly.

The backup should show the same path as the live demo, not a different older build.

## 6. Rehearsal

Run:
- one full technical rehearsal
- one timed 7-minute speaking rehearsal
- one failure rehearsal: assume the live agent or Stripe is slow and practice switching to backup

Record the actual total time and tighten until safely under 7 minutes.

## 7. Final checklist

- [ ] Correct commit is deployed.
- [ ] Lint/build green.
- [ ] Primary agent case green on live/Sonnet.
- [ ] Edge case green.
- [ ] Stripe test upgrade green.
- [ ] Free-limit state prepared for demo.
- [ ] No secrets in repo.
- [ ] Write-up submitted-ready.
- [ ] Slides final.
- [ ] Backup video works.
- [ ] Everyone knows their section.
- [ ] Timed rehearsal is <= 7 minutes.
- [ ] BIG_AUDIT has final status and known limitations.
