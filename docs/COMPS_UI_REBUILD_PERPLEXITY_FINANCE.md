# Comps UI Rebuild Specification
## Perplexity Finance × Fintool visual direction

> **Purpose:** Rebuild the Comps frontend so it feels like a modern financial-research product in the visual family of **Perplexity Finance** and **Fintool**, while preserving Comps' existing product scope, agent contracts, streaming behavior, citations, and Step 2 backend.
>
> **Important:** This is a UI/UX rebuild, not a product-scope expansion. Do not add fake market prices, price charts, analyst ratings, watchlists, portfolios, earnings data, or other functionality that Comps does not currently support.
>
> The target is **close visual and interaction parity in layout, density, typography, surfaces, hierarchy, research workflow, and answer presentation**, without copying Perplexity/Fintool logos, proprietary icons, brand names, or other trademarked assets.

---

# 1. Why we are doing this now

We are at the end of Step 2.

Step 2 already gives us the core research experience:

- ask a natural-language finance question
- stream the agent's research trace
- return a structured answer
- show comparison tables
- show verified citations
- show notes/caveats
- show follow-up questions
- handle clarification / unsupported / declined / off-topic states

Step 3 will add:

- free usage limits
- Stripe checkout
- Pro upgrade
- usage state

Step 4 is formally "frontend polish + QA."

## Recommended sequence

Do **not** wait until the very end of Step 4 to decide the UI structure.

Use this sequence instead:

### Step 2.5 — UI shell now
Build the visual system and the core research screen now:

- global layout
- sidebar
- top header
- research workspace
- prompt composer
- streaming trace treatment
- answer typography
- tables
- citations
- follow-ups
- empty state
- responsive behavior
- shared design tokens

### Step 3 — Stripe + usage
Build payment behavior into the already-established visual system:

- plan badge
- questions remaining
- upgrade CTA
- pricing screen
- Pro confirmation
- limit states

### Step 4 — final frontend + QA
Use Step 4 for:

- polish
- animation
- edge-state consistency
- responsive fixes
- accessibility
- visual QA
- browser QA
- demo hardening

This is preferable to implementing Stripe in one temporary UI and then redesigning every payment surface afterward.

---

# 2. Research findings

The visual direction below comes from current public Perplexity Finance surfaces and public Fintool surfaces.

## Perplexity Finance characteristics

Current Perplexity Finance UI repeatedly uses:

- dark, near-black background
- narrow vertical navigation rail
- compact top search/navigation
- strong company/page title area
- horizontally arranged navigation tabs
- thin borders instead of heavy shadows
- dark charcoal cards
- subtle radius, usually medium rather than highly rounded
- dense data presentation
- muted secondary labels
- green/red reserved for financial directional information
- tables with understated row separators
- persistent "ask" composer near the bottom of the research surface
- analysis presented as a continuous research workspace rather than chat bubbles
- source traceability integrated directly into research answers
- financial pages organized into:
  - overview
  - financials
  - earnings
  - holders
  - historical data
  - analysis
- compact toolbars rather than oversized UI controls

Public 2025–2026 Perplexity product updates also show:

- interactive finance tables
- financial statement insights
- historical-data views
- more advanced financial charts
- inline source traceability
- finance research workflows that behave more like a terminal/research workspace than a generic chatbot

## Fintool characteristics

Public Fintool surfaces emphasize:

- a very clean research-first layout
- large central question input
- ticker-aware finance queries
- simple typography
- strong whitespace
- "ask anything" as the primary action
- answers backed by SEC filings / earnings calls
- direct source citations
- suggested follow-up questions
- less decoration than consumer fintech dashboards
- analyst/research-tool feel rather than trading-app feel

## What Comps should borrow

From **Perplexity Finance**:

- dark research-terminal visual language
- sidebar
- content density
- compact navigation
- answer workspace
- sticky composer
- table treatment
- source treatment
- subtle cards/borders

From **Fintool**:

- research-first question flow
- source-backed answer hierarchy
- understated professional presentation
- follow-up query design
- lack of distracting consumer-finance widgets

---

# 3. Product constraint: do not imitate unsupported features

This rebuild must visually resemble these products without pretending Comps has their broader data coverage.

## Do not add

- stock-price chart
- real-time quotes
- analyst ratings
- price alerts
- prediction markets
- watchlists
- portfolios
- earnings calendars
- holders data
- screener
- historical-price download
- Morningstar research
- brokerage integrations
- account balances
- fake company overview data
- fake stock ticker cards
- fake "market open" indicators

unless those capabilities are deliberately added to the product later.

## Instead

Use the same **visual grammar** for the things Comps actually does:

| Perplexity / Fintool pattern | Comps equivalent |
|---|---|
| asset research page | question research workspace |
| financial statement table | benchmark comparison table |
| finance search bar | Comps question composer |
| cited finance answer | SEC-cited Comps answer |
| research traceability | Thought / Action / Observation trace |
| related questions | Comps follow-ups |
| asset metadata area | question title / detected companies |
| research sources | SEC filing + news source list |
| left navigation | Ask / History placeholder / Pricing / Account |

---

# 4. Overall visual goal

The app should feel like:

> **A compact institutional research workspace, not a student project and not a generic chatbot.**

Avoid:

- giant gradients
- glassmorphism
- huge rounded cards
- cartoon icons
- colorful SaaS landing-page sections
- chat bubbles
- excessive shadows
- oversized typography
- decorative finance graphics
- Tailwind-default-looking UI
- generic blue/purple AI styling

Use:

- dark charcoal
- warm off-black
- thin borders
- compact vertical rhythm
- calm typography
- small iconography
- data-first tables
- restrained hover states
- clear hierarchy
- lots of neutral gray
- one subtle accent color

---

# 5. Design tokens

Implement design tokens centrally rather than scattering Tailwind literals throughout components.

Use CSS variables in the global stylesheet.

```css
:root {
  --bg: #151514;
  --bg-elevated: #1b1b1a;
  --bg-subtle: #20201f;
  --bg-hover: #272725;

  --border: #31312f;
  --border-subtle: #292927;
  --border-strong: #3b3b38;

  --text-primary: #f1f1ef;
  --text-secondary: #b6b6b1;
  --text-muted: #7f7f7a;
  --text-faint: #62625e;

  --accent: #9bc4b1;
  --accent-hover: #acd1bf;
  --accent-soft: rgba(155, 196, 177, 0.10);

  --positive: #62b77a;
  --negative: #d76b73;
  --warning: #d4a85a;

  --sidebar-width: 60px;
  --content-max: 1120px;
  --answer-max: 820px;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}
```

The exact values may be adjusted after browser inspection, but preserve this visual direction.

## Light mode

Not necessary for the capstone unless already implemented.

Prioritize one excellent dark experience instead of two mediocre themes.

---

# 6. Typography

Use a neutral modern sans-serif.

Preferred stack:

```css
font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

If Inter is not already included and adding it creates unnecessary work, use the existing app/system font.

## Sizing

### Page / question heading
- 24–28px
- weight 500–600
- tight line height

### Answer body
- 15–16px
- line-height ~1.7
- weight 400

### Table values
- 13–14px

### Secondary labels
- 12–13px

### Navigation
- 12px

Avoid bold-heavy typography. Financial research products feel dense because hierarchy comes from spacing, alignment, color, and rules—not every label being bold.

---

# 7. App shell

Desktop structure:

```text
┌──────┬──────────────────────────────────────────────────────────┐
│      │ Top bar                                                  │
│ Left ├──────────────────────────────────────────────────────────┤
│ rail │                                                          │
│      │                                                          │
│      │              Research workspace                          │
│      │                                                          │
│      │                                                          │
│      │                                                          │
│      │      Sticky / bottom research composer                   │
└──────┴──────────────────────────────────────────────────────────┘
```

## Left sidebar

Width: approximately 56–64px.

Darkest surface.

Contains vertically:

Top:
- Comps mark / simple "C" monogram
- Ask / Home

Middle:
- New question
- optional History entry
- Pricing

Bottom:
- Help / info if needed
- account avatar / initials

### Important

Do not add nonfunctional navigation items just to look like Perplexity.

If History is not implemented:
- either omit it
- or render it disabled with an explicit "Coming soon"
- never create a clickable dead route

Icons:
- use the project's existing icon library if present
- otherwise use a single lightweight consistent library
- stroke icons around 16–18px
- no emoji

Selected sidebar item:

```text
subtle charcoal rounded rectangle
+
primary icon/text
```

Do not use bright accent fills.

---

# 8. Top bar

Height around 48–56px.

Structure:

```text
Comps / Research        [optional compact status]     Plan badge   User
```

Possible implementation:

Left:
- breadcrumb-style label: `Comps  /  Research`

Center:
- nothing initially
- keep visual breathing room

Right:
- `Free · 2 left` / `Pro`
- user avatar/menu

Thin bottom border.

No giant navbar.

No marketing navigation on the authenticated research page.

---

# 9. Empty research state

The empty state is extremely important.

Do not make it a dashboard full of fake widgets.

Center the working area vertically slightly above midpoint.

```text
                         Comps

          Research public companies with SEC data

     ┌──────────────────────────────────────────┐
     │ Ask about revenue, margins, cash flow…   │
     │                                          │
     │ [+]                               [ ↑ ]  │
     └──────────────────────────────────────────┘

       Try asking

       Compare Nike, Lululemon...
       How has Deckers...
       Compare Skechers...
```

## Heading

Use something restrained:

**Research companies with cited financials**

Supporting text:

**Compare fundamentals across years and peers using SEC filings.**

Do not oversell.

---

# 10. Main composer

This should be the strongest Fintool / Perplexity-like element.

## Shape

Large dark input surface:

- width 100%
- max-width about 760–820px
- min-height ~96px on empty state
- ~60–72px when sticky after answer
- border 1px
- radius 12–14px
- subtle elevated background
- no big shadow

## Placeholder

Examples:

`Ask about revenue, margins, cash flow, or peer performance…`

or

`Ask Comps about a public company…`

## Controls

Bottom left:
- optional plus icon only if there is an actual use for it
- otherwise omit

Bottom right:
- submit arrow button

Submit button:
- compact circle/square
- primary light neutral or muted accent
- disabled state when empty
- spinner while request starts

Do not add fake attachments, voice, model picker, or "Deep Research" switches.

---

# 11. Example question treatment

Avoid large cards.

Use narrow rounded rows / chips similar to research suggestions.

Desktop:

```text
Compare Nike, Lululemon, and Under Armour's gross margin over 5 years  ↗
How has Deckers' revenue and operating income grown since 2020?       ↗
Compare Skechers and Nike's inventory and cash flow trends            ↗
```

Style:

- transparent or subtle elevated background
- 1px border
- 13–14px
- hover background
- cursor pointer
- no gradients

---

# 12. Submitted question state

After submission, transition from landing layout into a research-document layout.

At the top of the content column:

```text
Research

Compare Nike, Lululemon, and Under Armour's
gross margin over the last 5 years

Asked just now
```

Do **not** render the user's message as a chat bubble.

Perplexity-style research UI treats the query like a document heading.

Question width should match answer width.

---

# 13. Research trace

The existing Step 2 Thought / Action / Observation trace is a differentiator.

It should visually resemble a compact research-progress module, not debug logging.

## Running state

Immediately under the question:

```text
Researching
────────────────────────────────────────────

✓ Identified NIKE, Inc. (NKE)
✓ Identified lululemon athletica (LULU)
● Fetching annual financials...
○ Calculating gross margins
```

Thought text may be shown smaller and muted:

```text
Comparing the companies requires the same metric
across aligned fiscal periods.
```

## Visual rules

Action:
- 13px
- primary or secondary text
- spinner while active

Observation:
- 12–13px
- muted
- concise summary

Thought:
- smaller
- muted
- never shown as a giant card

Do not expose raw JSON.

## Completed state

Collapse into:

```text
▸ Researched in 4 steps
```

Clicking expands details.

This is much closer to modern research tools than leaving a large open debug panel above every answer.

---

# 14. Answer workspace

The answer should look like a research note, not an assistant message.

Maximum readable answer width: ~760–820px.

Suggested flow:

```text
Answer

[2–4 sentence takeaway]

Benchmark
[table]

Analysis
[paragraphs]

Notes
[caveats]

Sources
[source list]

Related
[follow-up questions]
```

Do not necessarily add literal headings when the answer content does not need them. The goal is hierarchy, not template clutter.

---

# 15. Answer prose

Body style:

- 15–16px
- ~1.65–1.75 line height
- primary text
- paragraphs with 12–16px separation

Inline citation markers:

```text
Nike's FY2024 gross margin was 44.6% [1]
```

Render markers as subtle superscript-like source pills or compact linked numbers.

Suggested:

```css
font-size: 11px;
vertical-align: super;
color: var(--accent);
```

Hover:
- light accent background
- no aggressive underline unless appropriate

---

# 16. Financial tables

This is one of the most important visual elements.

Perplexity Finance uses financial tables with:

- dense rows
- minimal borders
- dark surface
- muted labels
- strong numeric alignment
- subtle column headers
- no spreadsheet-style heavy grid

## Comps table

```text
Gross margin

              FY2024            FY2023            FY2022
Nike          44.6% [1]         43.5% [2]         46.0% [3]
Lululemon     59.8% [4]         58.3% [5]         57.7% [6]
Under Armour  46.1% [7]         44.9% [8]         —
```

## Styling

Container:
- preferably no oversized card
- optional top/bottom border
- radius only if the current page structure benefits

Header:
- muted text
- 12px
- medium weight
- bottom divider

Rows:
- 42–48px
- subtle separator
- hover only if useful

Numbers:
- tabular numeric rendering if available
- right aligned
- primary text

Company/metric labels:
- left aligned
- slightly stronger

Missing values:
- muted em dash

Horizontal scroll on narrow screens.

Do not force every cell into pill badges.

---

# 17. Fiscal-year metadata

Comps has an important trust feature that competitors often obscure: period-end dates.

Display them without overwhelming the table.

Example:

```text
FY2024
May 31, 2024
```

Header:

```text
FY2024
ended May 31
```

Secondary line:
- 10–11px
- muted

When periods differ substantially between companies, preserve the current notes/caveat behavior.

Never hide the dates purely for visual cleanliness.

---

# 18. Notes and caveats

Current notes such as:

- assumed company match
- missing year
- differing fiscal periods
- removed unsupported citation
- missing operating income

should look like restrained research annotations.

Avoid bright amber alert boxes for normal caveats.

Use:

```text
ⓘ Notes
• Under Armour changed fiscal year-end...
• FY2022 is not shown because...
```

Surface:
- subtle elevated background or left border
- muted icon
- 13px

Use warning color only for genuinely important warnings.

---

# 19. Sources

Make sources feel like Perplexity citations rather than a bibliography.

Heading:

`Sources`

Each source row:

```text
[1] NIKE 10-K
    FY2024 · ended May 31, 2024 · filed Jul 25, 2024
    SEC EDGAR ↗
```

For news:

```text
[8] Under Armour cuts outlook...
    Reuters · Aug 2026 ↗
```

Design:

- source number column
- title
- metadata line
- external-link icon
- row hover background
- no huge cards

Spacing:
~10–12px between source rows.

Keep the existing verified citation resolution behavior untouched.

---

# 20. Follow-up questions

This is a shared Fintool / Perplexity pattern and should be prominent.

Heading:

`Ask a follow-up`

Rows:

```text
How has inventory changed over the same period?          →
Compare operating cash flow across the three companies  →
Which company improved margins the most?                 →
```

Use full-width subtle rows.

Click:
- populates + immediately submits if that is existing behavior
- otherwise populate composer consistently

Do not turn these into large colored buttons.

---

# 21. Sticky follow-up composer

Once an answer exists, place the composer near the bottom of the viewport/content surface.

Conceptually:

```text
┌──────────────────────────────────────────────────┐
│ Ask a follow-up…                            [↑]  │
└──────────────────────────────────────────────────┘
```

Recommended behavior:

- `position: sticky`
- bottom ~16–24px
- same content-column alignment
- slight backdrop separation
- never cover final source rows
- include bottom padding in page content to account for it

On mobile:
- full width minus margins
- bottom safe-area aware

---

# 22. Loading behavior

No full-screen spinner.

The user should instantly see:

1. submitted question
2. research trace
3. progressively completed tool steps
4. final answer

The submit button may enter loading state, but the research workspace itself communicates progress.

Use subtle animated dots/spinner.

Avoid skeletons pretending answer content exists before the tool result.

---

# 23. Error states

Errors should remain within the research workspace.

Example:

```text
We couldn't complete this research

The SEC request timed out after a retry.
Try the question again.

[ Try again ]
```

Do not use giant red banners.

Use red only:
- small icon
- small border/accent
- concise title

---

# 24. Non-answer result types

These must remain visually deliberate.

## Clarification

```text
Which company did you mean by "Delta"?

Delta Air Lines (DAL)      →
Delta Apparel (...)        →
...
```

This should feel like a normal research continuation, not an error.

## Not covered

```text
Adidas isn't covered by Comps

Comps currently analyzes companies that report through
SEC EDGAR. Try Nike, Deckers, VF Corp, or Under Armour.
```

## Declined

```text
Comps doesn't make buy or sell recommendations.

I can compare Nike's margins, growth, cash flow, and
peer performance instead.
```

## Off topic

Minimal neutral state.

## Insufficient data

Show what was successfully retrieved and explain what was missing.

Do not discard useful partial research.

---

# 25. Pricing UI placeholder before Step 3

The visual route can be built before Stripe is implemented.

Create the final visual structure now, then wire behavior in Step 3.

## Pricing page

Perplexity/Fintool-inspired, not generic SaaS pricing cards.

Page structure:

```text
Comps

Simple research access

Free
$0
3 research questions

Pro
$19 one-time
25 questions / day
[ Upgrade to Pro ]

Team
Contact us
Built for analyst teams
[ Contact us ]
```

Keep it restrained.

Cards:
- thin border
- charcoal background
- 12–14px radius
- no gradient
- no giant "MOST POPULAR" banner

Highlight Pro with:
- slightly stronger border
- small `Recommended` label if desired

Until Step 3:
- upgrade button may be visually complete but should clearly remain unhooked / behind the existing stub
- do not create fake successful payment behavior

---

# 26. Usage badge placeholder

Design now:

Free:

```text
Free · 2 left
```

Pro:

```text
Pro
```

Later Step 3 may provide:

```text
Pro · 23 left today
```

Use a compact bordered pill in the header.

No bright gold Pro badge.

---

# 27. Responsive behavior

## Desktop > 1100px

- left rail: 60px
- centered workspace
- content max ~1120px
- readable answer max ~820px

## Tablet

- rail remains narrow if usable
- reduce outer margins
- tables horizontal-scroll

## Mobile

Sidebar becomes:
- compact top navigation
or
- small drawer

Do not squeeze the desktop sidebar into an unusably narrow screen.

Mobile workspace:
- 16px side padding
- tables scroll
- composer remains easy to reach
- source metadata wraps cleanly
- no horizontal page overflow

---

# 28. Motion

Motion should be almost invisible.

Use ~120–180ms transitions for:

- hover background
- border color
- trace expand/collapse
- disabled/active states

No:
- spring animations
- floating blobs
- card entrance choreography
- dramatic page transitions

---

# 29. Component architecture

Prefer reusable visual primitives.

Suggested structure, adapted to the actual repo rather than forced blindly:

```text
components/
  layout/
    app-shell
    sidebar
    top-bar

  research/
    research-workspace
    empty-state
    question-header
    question-composer
    example-questions
    agent-trace
    answer-view
    answer-table
    answer-notes
    sources-list
    follow-up-list

  billing/
    plan-badge
    pricing-card
    upgrade-cta

  ui/
    button
    icon-button
    divider
    status-pill
```

Do not create files solely because this document lists them.

First inspect the existing component structure and reuse/refactor intelligently.

---

# 30. Existing component guidance

The existing Step 2 UI currently includes core pieces such as:

- ask form
- agent trace
- answer view

Preserve their behavioral responsibilities.

Refactor presentation where useful, but do **not** break:

- NDJSON parsing
- streaming state
- matching action/observation IDs
- citation linking
- structured tables
- notes
- follow-up submission
- answer-kind handling

The UI rebuild should sit on top of the existing data contracts.

---

# 31. Page structure after an answer

Target:

```text
┌─ sidebar ─┬───────────────────────────────────────────────────┐
│           │ Comps / Research                 Free · 2 left  P │
│           ├───────────────────────────────────────────────────┤
│           │                                                   │
│           │  Research                                         │
│           │                                                   │
│           │  Compare Nike, Lululemon, and Under Armour's     │
│           │  gross margin over the last 5 years              │
│           │                                                   │
│           │  ▸ Researched in 4 steps                          │
│           │                                                   │
│           │  Nike maintained... [1]                           │
│           │                                                   │
│           │  Gross margin                                     │
│           │  ─────────────────────────────────────────────    │
│           │  ...table...                                      │
│           │                                                   │
│           │  Notes                                            │
│           │  ...                                              │
│           │                                                   │
│           │  Sources                                          │
│           │  [1] Nike 10-K...                                 │
│           │  [2] ...                                          │
│           │                                                   │
│           │  Ask a follow-up                                  │
│           │  ...                                              │
│           │                                                   │
│           │  ┌─────────────────────────────────────────────┐  │
│           │  │ Ask a follow-up...                     ↑   │  │
│           │  └─────────────────────────────────────────────┘  │
│           │                                                   │
└───────────┴───────────────────────────────────────────────────┘
```

---

# 32. Visual acceptance criteria

Do not call the rebuild complete unless all are true.

## App shell
- [ ] dark professional finance/research aesthetic
- [ ] narrow navigation rail
- [ ] compact header
- [ ] unified background/surface system
- [ ] no generic SaaS gradient styling

## Empty state
- [ ] centered research composer
- [ ] concise product positioning
- [ ] clean example prompts
- [ ] no fake market dashboard

## Research state
- [ ] submitted question becomes document-style heading
- [ ] live trace is visible while running
- [ ] completed trace collapses cleanly
- [ ] no raw JSON

## Answer
- [ ] readable research-note typography
- [ ] dense professional tables
- [ ] citations visually integrated
- [ ] notes understated
- [ ] sources easy to inspect
- [ ] follow-ups look like research continuations

## Composer
- [ ] Fintool/Perplexity-style input surface
- [ ] clear loading state
- [ ] sticky follow-up composer after answer
- [ ] does not obscure content

## Billing readiness
- [ ] plan badge visual exists
- [ ] pricing page visual exists
- [ ] upgrade state has an obvious home
- [ ] no fake Stripe behavior

## Responsive
- [ ] no viewport overflow
- [ ] financial tables scroll horizontally
- [ ] composer works on mobile
- [ ] sidebar adapts on mobile

---

# 33. Functional acceptance criteria

The redesign must not regress Step 2.

Verify:

- [ ] question still posts to the existing agent route
- [ ] NDJSON still parses incrementally
- [ ] trace appears before final result
- [ ] all TraceStep types render correctly
- [ ] final answer renders from the existing structured result
- [ ] tables use `answer.tables`
- [ ] citations use resolved sources, not reconstructed URLs
- [ ] notes render
- [ ] exactly the returned follow-ups render
- [ ] clicking follow-up works
- [ ] clarification works
- [ ] not-covered works
- [ ] declined works
- [ ] off-topic works
- [ ] insufficient-data works
- [ ] loading/error states do not crash
- [ ] build passes
- [ ] lint passes

---

# 34. Explicit non-goals for this UI pass

Do not modify unless a real bug is discovered:

- ReAct loop
- prompt
- tool definitions
- SEC normalization
- calculator
- citation registry
- final-answer schema
- agent iteration limit
- retry behavior
- database schema
- Stripe implementation
- usage calculation

This pass is about presentation and page composition.

If the visual implementation exposes a true backend defect, stop and report it before changing backend architecture.

---

# 35. Implementation sequence for Claude Code

Use this exact order.

## Component 1 — inspect and plan

Before editing:

1. read project control docs
2. inspect current page/layout/components/global CSS
3. inspect package dependencies
4. inspect current Step 2 UI behavior
5. run current app if possible
6. list files expected to change
7. report any proposed dependency addition before installing it

Do not code until the current structure is understood.

## Component 2 — design tokens + app shell

Implement:

- dark token system
- page background
- sidebar
- top bar
- workspace container

Test:
- app renders
- auth pages are not unintentionally broken
- no horizontal overflow

## Component 3 — empty state + composer

Implement:

- empty research landing
- primary composer
- example queries

Preserve current submit behavior.

## Component 4 — research question + trace

Implement:

- question heading
- live trace
- completed collapsed trace

Preserve all streaming semantics.

## Component 5 — answer renderer

Implement:

- prose hierarchy
- financial table styling
- citation markers
- notes
- sources
- follow-ups

No schema changes.

## Component 6 — sticky follow-up composer

Implement after answer.

Ensure:
- final sources remain scrollable
- composer does not cover content

## Component 7 — non-answer states

Apply consistent visual treatment to all existing kinds.

## Component 8 — pricing visual + plan badge shell

Create the visual states needed for Step 3.

Do not fake Stripe behavior.

## Component 9 — responsive + accessibility

Check desktop, tablet, narrow/mobile.

## Component 10 — regression

Run:

```bash
npm run lint
npm run build
```

Then manually test the main Step 2 flows.

---

# 36. Instructions for Claude Code

## Before changes

Read:

- CLAUDE.md
- SPEC.md
- DESIGN.md
- PRD.md
- ARCHITECTURE.md
- BIG_AUDIT.md
- Step 2 plan
- relevant eval definitions

Then inspect the actual current UI implementation.

## Important

Do not blindly create the component/file names proposed here.

They describe responsibility boundaries, not mandatory filenames.

Match the existing repo and minimize unnecessary churn.

## Do not change backend behavior

No agent changes unless required to repair a real regression.

## Dependencies

Avoid adding a heavy UI framework.

Prefer:

- existing Tailwind setup
- existing icon package if one exists
- small reusable local components

Do not install a dashboard template.

Do not install a full component system merely to achieve this look.

---

# 37. Final desired impression

When the professor opens Comps, the immediate reaction should be:

> "This looks like a real financial research product."

Not:

> "This looks like a class chatbot with a finance prompt."

The highest-priority visual signals are:

1. **dark finance-research workspace**
2. **high-quality prompt composer**
3. **document-style answer instead of chat bubbles**
4. **dense financial comparison tables**
5. **visible but restrained research trace**
6. **excellent citation/source treatment**
7. **professional follow-up workflow**
8. **compact navigation and plan state**
9. **no fake finance data or unnecessary dashboard clutter**

---

# 38. Research basis

This specification was informed by public 2025–2026 product material and screenshots showing:

### Perplexity Finance
- dark Finance company pages
- narrow left navigation
- compact top search
- company navigation tabs
- financial-statement tables
- dark chart/data cards
- bottom question composer
- cited finance research
- financial statement insights
- source traceability
- dense dashboard layouts

Public Perplexity changelog material reviewed included updates covering:
- SEC filing search
- financial statement insights
- historical-data pages
- interactive finance data
- improved finance charts
- Finance timeline
- source traceability in finance research
- streamlined input-bar design

### Fintool
Public Fintool product surfaces reviewed showed:
- equity-research positioning
- centered "ask anything" research workflow
- SEC filing / earnings-call grounding
- cited answers
- suggested follow-up questions
- minimal professional layout

---

# 39. One final rule

**Copy the interaction quality and visual grammar, not unsupported product capabilities or branded identity.**

Comps should still unmistakably be **Comps**.

The ideal result is:

> **Perplexity Finance's polished dark research workspace + Fintool's focused SEC-research workflow + Comps' existing agent trace and verified benchmark answers.**
