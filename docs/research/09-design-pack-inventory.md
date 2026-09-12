# TrainOS design pack — build inventory

Source: `/Users/khumeren/Downloads/Waiting on scope answers (1)/` (read-only). This document is a
complete extraction of tokens, components, screens, layout patterns, fixture data and design rules
from the `.dc.html` artboard pack, `build/kit.js`, `REPORT.md`, `DECISIONS.md` and `CLAUDE.md`, so a
React team can build every screen and kit component from this inventory plus the source files without
re-deriving anything. Nothing here is proposed — every value is quoted or paraphrased from the source.

Non-goals honoured: this document does not read `API_CONTRACT.md` and does not propose React code or
component APIs beyond what the source implies.

---

## 1 · Tokens

### 1.1 Colour tokens (`build/kit.js`, object `K.C`)

| Token key | Hex | Role |
|---|---|---|
| `ink` | `#181A1F` | Primary text, charcoal accent (profile header, dark base, avatars) |
| `sec` | `#50565F` | Secondary text |
| `mut` | `#69717C` | Muted text — floor for any text a user must read (5.3:1 on white, 4.8:1 on sidebar) |
| `dis` | `#A3A9B2` | Disabled controls and rule/pending markers **only** — never body text |
| `bd` | `#E3E7EC` | Standard 1px container border |
| `div` | `#ECEFF3` | Divider / hairline inside a surface |
| `surf` | `#FAFBFC` | Subtle surface — table headers, recessed rails, zebra rows |
| `side` | `#F3F5F7` | Sidebar surface |
| `canvas` | `#F7F8FA` | App canvas background behind the white card |
| `blue` | `#1F5BFF` | Electric blue — primary accent |
| `blueT` | `#1849D6` | Blue hover / text-on-tint (links, accent text) |
| `tint` | `#F4F7FF` | 6% blue tint — reserved for AI surfaces |
| `tint2` | `#EBF1FF` | 10% blue tint — selected row, active nav, active pill |
| `bblue` | `#CBD8FF` | Accent border (AI card borders, chip borders) |

Additional foundation values called out in Kit.dc.html §01 but not in `K.C` (used as literals):
- Border strong (emphasised container, e.g. consequence block): `#D5DAE1`
- Status colours (chips only): Success `#2B7153` text / `#ECF6F0` fill / `#BFDCCB` border · Warning
  `#966119` / `#FFF7E8` / `#ECD29C` · Danger `#B9413D` (also seen as `#B4403B`, treat as the same
  danger red — both appear in source) / `#FFF0EF` / `#ECC2BF` · Neutral `#50565F` / `#FAFBFC` / `#E3E7EC`
  · Info (sync/scope chips) `#466487` / `#EFF3F7` / `#CBD7E3`
- Hover surface: `#F1F4F8`
- On-primary label: `#fff` (button text on solid blue)

**Rule:** blue budget is 5–15% of any screen, in priority order — one primary button, active nav,
links, focus ring, current-step ring, AI surfaces. AI is always the 6% tint (`tint`) plus the ✦ glyph
and a text label, never a solid fill; solid blue always means a human triggered the action.

### 1.2 Dark-mode token map (from `Dark mode.dc.html`, section 01 "Token map")

Dark is a straight token swap — no component, layout, spacing or geometry changes between themes.
Every row below is Name → Light → Dark → Note, reproduced from the source table:

| Token | Light | Dark | Notes |
|---|---|---|---|
| Canvas | `#F7F8FA` | `#0D1117` | App background behind the card |
| Sidebar surface | `#F3F5F7` | `#131820` | Stays one step off the canvas |
| Card / raised | `#FFFFFF` | `#171C25` | Every content card and popover |
| Surface subtle | `#FAFBFC` | `#1B212B` | Table headers, recessed rails, zebra rows |
| Hover surface | `#F1F4F8` | `#1E2530` | Row and nav hover |
| Border | `#E3E7EC` | `#2A323E` | 1px container borders |
| Divider | `#ECEFF3` | `#232A35` | Hairlines inside a surface |
| Border strong | `#D5DAE1` | `#3A4350` | Emphasised container (consequence block) |
| Text primary | `#181A1F` | `#E8EBF0` | Never pure white — reduces halation |
| Text secondary | `#50565F` | `#AAB2BE` | — |
| Text muted | `#69717C` | `#8992A0` | AA on the dark card at 12px |
| Text disabled | `#A3A9B2` | `#5C6572` | Disabled controls and rules only |
| Primary (blue) | `#1F5BFF` | `#4C82FF` | Lifted for contrast on dark |
| Primary text/hover | `#1849D6` | `#9DBBFF` | Links and accent text |
| Tint 6% (AI) | `#F4F7FF` | `#16213A` | AI surfaces; ✦ and label unchanged |
| Tint 10% (selected) | `#EBF1FF` | `#1B2A47` | Selected row, active nav, active pill |
| Accent border | `#CBD8FF` | `#2E4478` | — |
| Success | `#2B7153` | `#6FD3A0` | Chip text/fill · fill `#ECF6F0` → `#122A20` |
| Warning | `#966119` | `#E8B45C` | Chip text/fill |
| Danger | `#B4403B` | `#F08A85` | Chip text/fill |
| Info | `#466487` | `#9DBEE4` | Sync·Sent, scope chips · fill `#EFF3F7` → `#16202B` |
| On-primary label | `#FFFFFF` | `#F2F5FF` | Text on a solid primary button — stays near-white both themes |
| Avatar surface | `#181A1F` | `#2A323E` | Charcoal circle → raised graphite chip, light initials |

Rules that survive the theme swap (verbatim from source): three colours only (ink neutrals, electric
blue, charcoal/graphite); blue budget stays 5–15%; AI stays a 6% tint + ✦ + label, never a solid fill;
status colour still lives on chips only; shadows deepen rather than lighten
(`rgba(0,0,0,.55)` in dark vs `rgba(0,0,0,.04)` in light) and elevation is carried by surface
lightness, not heavier borders.

Two things flagged as needing integration care: text primary is `#E8EBF0` not pure white (reduces
halation), and the primary blue lifts from `#1F5BFF` to `#4C82FF` to keep 4.5:1 on its own surface,
while the on-button label stays near-white in both themes (the accent never carries dark text).

Dark twins exist 1:1 for every light screen; the file-to-file mapping is: `Kit.dc.html` →
`Dark Kit screens.dc.html`, and each `M?? *.dc.html` → `Dark M?? *.dc.html` with the same screen ids
(`#m01s01`, `#m02s01`, etc.). Confirmed present dark twins: Kit screens, M01, M02, M03, M05, M06, M07,
M09, M10, M12, M13, M16, M18, M20, and `Dark mode.dc.html` itself (which also embeds the M01 and M13
proof screens directly). No `Dark M22 Demo script.dc.html` exists — see §8.

### 1.3 Typography

Font stack: **Inter** (weights 400/500/600/700) for UI text, **JetBrains Mono** (weights 400/500) for
labels, metadata, monospace figures and screen-id badges. Loaded via Google Fonts
(`family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500`).

Type scale (Kit.dc.html §01 "Type scale — Inter"):

| Size / weight | Usage | Example |
|---|---|---|
| 28 / 600, `-0.02em` | Page title | "Page title" |
| 20 / 600, `-0.01em` | Section heading | "Section heading" |
| 15 / 400 | Body | "Aurora Manufacturing Sdn Bhd" |
| 13 / 400, colour `sec` | Dense body / table cells | "RM 18,500 · 12 Nov 2026" |
| 11 / 500 mono, `0.06em` uppercase | Label · metadata · screen id | — |

RecordHeader identity is 22px/600/`-0.015em`. MetricStrip cell values are 16px/600 mono
(`-0.01em`), labels are 11px mono uppercase.

### 1.4 Geometry, radii, borders, shadows

From Kit.dc.html §01 "Geometry":
- Spacing grid: 8px with a 4px half-step.
- Radii: card 12px · control 8px · chip 999px (pill). RecordHeader card and some shells use 14px;
  the profile modal uses 18px — treat 12/14/18 as the card-radius range depending on container size,
  8px as the control radius, 999px as the pill radius.
- Borders: 1px `#E3E7EC` (light) / `#2A323E` (dark) everywhere; no shadow heavier than
  `0 1px 2px rgba(0,0,0,.04)` in light, `rgba(0,0,0,.55)` in dark.
- Desktop canvas: **1440×900** per screen artboard.
- Shell geometry: sidebar and topbar height are documented in two places with a **discrepancy** — see
  §8. The built components use sidebar **240px** and topbar **56px**; the Foundations panel text says
  "sidebar 232".
- Rail (collapsed sidebar) width: **64px**, with flyout on hover ("Rail · 64 with flyout").
- Profile modal width: **960px**, with a 320px left identity rail and a 176×176px avatar circle
  overlapping the rail edge by −72px.

### 1.5 Placeholders

No imagery, no illustration, no logos anywhere in the wireframes. Avatars and documents render as
crossed grey boxes (a diagonal-hatch pattern on `#FAFBFC` with an `#E3E7EC` border); a document
placeholder additionally carries a small "document thumb" label chip.

---

## 2 · Navigation TREE and ROLE map (verbatim from `build/kit.js`)

### 2.1 TREE (nav groups → parents → children; numbers are static badge counts, alert badges render red)

```js
const TREE = [
 ['MAIN', [
   ['Home','⌂',[['Dashboard'],['Approvals',7],['My tasks']]],
   ['Sales','⚑',[['Enquiries'],['Leads'],['Organisations'],['Contacts'],['Pipeline'],['TNA'],['Proposals']]],
   ['Relationships','⇄',[['Renewals'],['Cross-sell'],['Marketing']]]]],
 ['OPERATIONS', [
   ['Training','▧',[['Programmes'],['Engagements'],['Calendar'],['Trainers'],['Participants'],['Assessments'],['Certificates']]],
   ['Compliance','⚖',[['HRD Corp',3],['Rules'],['Rule changes',3],['Documents'],['Deadlines']]],
   ['Finance','▬',[['Quotations'],['Invoices'],['Collections'],['Commissions'],['Profitability']]]]],
 ['KNOWLEDGE', [['Knowledge','▢',[['Library'],['Sources',1],['Templates'],['Knowledge base']]]]],
 ['SYSTEM', [
   ['Automation','⌬',[['Agents'],['Runs'],['Failures',2],['Policies']]],
   ['Reports','◫',null],
   ['Settings','⚙',[['Organisation'],['AI Models'],['Providers'],['Usage'],['Templates'],['Policies']]]]],
];
```

Note: `Reports` has no children (`null`) — it renders as a leaf item under SYSTEM, not an expandable
parent.

### 2.2 ROLE map (which groups/parents each role sees; `admin: null` = sees everything)

```js
const ROLE = {
  sales:      { MAIN:['Home','Sales','Relationships'], OPERATIONS:['Training'], KNOWLEDGE:['Knowledge'] },
  ops:        { MAIN:['Home'], OPERATIONS:['Training','Compliance'], KNOWLEDGE:['Knowledge'] },
  finance:    { MAIN:['Home'], OPERATIONS:['Finance','Compliance'], KNOWLEDGE:['Knowledge'] },
  exec:       { MAIN:['Home','Sales','Relationships'], OPERATIONS:['Finance'], SYSTEM:['Automation','Reports'] },
  admin:      null,
  compliance: { MAIN:['Home'], OPERATIONS:['Compliance','Finance'], KNOWLEDGE:['Knowledge'] },
};
```

An assumption logged on M01-S01: the **exec** (MD) sidebar variant is documented there as showing
Home, Sales, Relationships, Finance, Automation, Reports — this matches the `exec` role map above.
A second logged assumption (M06-S02) says Sales sees Training → Programmes **read-only**; the ROLE
map only controls which nav sections are visible, not field-level edit rights, so read/write is a
screen-level concern layered on top of this map.

### 2.3 Badge semantics

- **Nav count badge** (default): `background:#F4F7FF; color:#1849D6; border:1px solid #CBD8FF` — a
  neutral/informational count (e.g. Approvals 7, Sources 1).
- **Nav alert badge**: same shape, `background:#FFF0EF; color:#B4403B; border:1px solid #ECC2BF` —
  used automatically whenever the badge total includes items in a group named `Failures`
  (`badge(sum, kids.some(k=>k[0]==='Failures'))` in `K.sidebar`), e.g. Automation shows an alert badge
  because it sums Runs/Failures/Policies and Failures is present.
  A second alert instance is the notification-bell badge in the top bar (`background:#FFF0EF;
  color:#B4403B`), independent of the nav tree, shown as a fixed "4" in the kit sample.
- **Screen-id badge** (on every artboard, not navigation): `font-family:JetBrains Mono; font-size:11px;
  color:#fff; background:#181A1F; padding:3px 8px; border-radius:4px` — the black pill preceding every
  screen title (e.g. `M07-S03`).
- **Active-nav indicator**: parent row gets `background:tint2 (#EBF1FF); color:blueT` and a "–"
  affix when expanded; the active child gets a white raised pill
  (`box-shadow:0 1px 2px rgba(0,0,0,.06)`) with a solid 6px blue dot; inactive children get a 6px
  `dis` (`#A3A9B2`) dot. A vertical `#CDD3DB` connector line runs from the parent row to the last
  child dot.

---

## 3 · Kit component catalogue (Kit.dc.html, 10 numbered sections)

Kit.dc.html is laid out in 10 sections numbered 01–10 in the page, but section **06 "Proof screens"**
is physically appended at the *end* of the file (after section 10) even though its number sits
between 05 and 07 in the numbering sequence — this is a file-assembly artifact, not a content error.
Sections in file order: 01 Foundations, 02 AI & approval primitives, 03 Controls/containers/states,
04 Workflow steppers, 05 System surfaces, 07 Shell, 08 Data table, 09 RecordHeader & MetricStrip,
10 AI operations components, 06 Proof screens.

For "screens using it" below, `grep`-derived cross-references come from each screen's own
"Components used" annotation line (§4); a dash means no screen's own annotation names that exact
component (it may still appear implicitly, e.g. every screen with a sidebar uses the Shell).

### 3.1 §01 Foundations
Not components but the base tokens/type/geometry/placeholders documented in §1 above. No screens
"use" this section directly — every screen inherits it.

### 3.2 §02 AI & approval primitives

**AI badge**
- Variants shown: `AI-generated · 82%` (blue dot), `AI-assisted · edited` (blue dot),
  `Low confidence · 41%` (amber dot on blue chip).
- Props implied: `label` (generated/assisted/low-confidence/etc.), `confidencePct` (nullable — the
  "edited" variant has none), `dotColor` (blue=normal, amber=low-confidence trigger).
- Anatomy (5 lines): pill chip, `tint`/`bblue` border, 5px coloured dot, 12px/500 label text in
  `blueT`; a companion hover popover panel (bordered `bblue`, background `#FCFAFF`) shows reasoning
  prose, then two mono metadata lines — agent/run/duration/cost, then model/provider/cache-hit/tier.
- Screens: M03-S02, M03-S06, M05-S02, M07-S02, M12-S02, M12-S07, M12-S08, M13-S05, M18-S04 (all via
  "AI panel"/"AI badge popover"/provenance line references in their annotations).

**Autonomy chip — the ladder**
- Variants/states: Observe (grey, "logs only"), Suggest (blue tint, "drafts, human sends"), Act w/
  approval (blue tint, "queued to Approvals"), Autonomous (blue tint, heavier 1.5px border, "acts,
  notifies after").
- Props implied: `level` (one of the 4 ladder rungs) — border weight rises with level so risk reads
  without a second hue.
- Anatomy: fixed-width (118px) pill, border weight 1px→1.5px as level rises, trailing caption text.
- Screens: M02-S01 ("autonomy chips"), M03-S02, M03-S06, M13-S05, M18-S01, M20-S20.

**Status, sync & lock chips**
- Variants: workflow status (Draft/Awaiting approval/Sent/Accepted/Lost), sync state (Not sent/Sent/
  MyInvois Validated/Error), lock chip (`🔒 Locked · HRDC approved`), stage chip (`Stage · Proposal
  sent`).
- Props implied: `kind` (neutral/warn/info/success/danger), `label` text.
- Screens: M02-S02 (kit proof, "chips"), M13-S02 ("sync chips, empty state"), M10-S06 ("locked chip"),
  M06-S02 ("chip row"), M12-S07 ("filter chips").

**Approval banner**
- Variants: pending (amber, 3 actions: Approve/Request changes/Reject), decided (neutral, "Approved
  by … · View audit trail" link).
- Props implied: `state` (pending/decided), approver name+role, subject+value+SLA text, decided-by +
  timestamp + channel.
- Anatomy: bordered/tinted row, left text block (title 13/600 + subtitle 12px `sec`), right-aligned
  action cluster or single link.
- Screens: M02-S01 (approval-banner style row inside the queue), Kit proof M02-S02 ("approval detail"
  is this pattern expanded to a full page).

**Proposed-action card**
- Variants: single state shown (Act w/ approval), but structurally supports any autonomy level via its
  header chip.
- Props implied: agent name, action title, autonomy chip, 3 metric cells (value/confidence/channel),
  a diff block (+ green / − red mono lines), action row (Approve & send / Edit before use / Reject).
- Anatomy: card with tinted header (`tint` background, `bblue` border-bottom) holding agent chip +
  title + autonomy chip, body grid of 3 metrics, a bordered diff sub-block, footer button row.
- Screens: M02-S02 (kit proof — "recommendation → evidence and risk → what changes" narrative structure
  mirrors this card), M12-S08 ("add-modify-supersede cards with provenance").

### 3.3 §03 Controls, containers & states

**Buttons & inputs**
- Button kinds: Primary (solid blue), Secondary (white/bordered), Ghost (transparent), Disabled
  (muted, `cursor:not-allowed`). Matches `K.btn(t, kind)` in kit.js exactly (kinds: default/primary/
  danger/ghost — danger renders bordered white with red label, not shown in this static swatch but
  defined in kit.js).
- Input states shown: default text input, focused input (`border:#1F5BFF`), select/dropdown
  (trailing ▾).
- Screens: every screen (buttons are ubiquitous); explicitly named in nearly all annotations.

**Stepper** (compact vertical variant, distinct from the horizontal LifecycleStepper family in §04)
- States: done (filled black circle + ✓), current (white circle, 2px blue ring), pending (white,
  1px border).
- Anatomy: vertical dot-and-connector list, each row = dot+connector column beside a label+date
  column.
- Screens: none named explicitly as "Stepper" in annotations (the horizontal family in §04 is what
  screens actually cite as "LifecycleStepper").

**Checklist & completeness**
- States: checked item (black square + ✓), unchecked item (bordered square, muted label), plus a
  completeness bar (label/percent row + track/fill bar).
- Props implied: `items[{label, done}]`, `completenessPct`.
- Screens: M09-S02 ("checklist"), M12-S02 ("document checklist with previews" — the REPORT.md addition
  "Document checklist row" extends this with a thumbnail + attach/view action).

**WhatsApp cost strip**
- Variants: single template category shown (Marketing) with recipients, per-message rate, and total;
  a caption computes the Utility-template savings delta.
- Props implied: `category` (Utility/Marketing — real Malaysian BSP rates: Utility RM 0.0564,
  Marketing RM 0.3467), `templateId`, `recipients`, `ratePerMsg`, `estimatedCost`.
- Screens: M03-S06 ("WhatsApp cost strip"), M13-S05 ("WhatsApp cost note" — REPORT.md notes this was
  collapsed to one line after overflowing by 52px).

**Money input · RM**
- States: default (bordered, right-aligned mono value with an "RM" prefix chip), error/below-floor
  (red border + red caption).
- Props implied: `value`, `currency` (fixed "RM"), `error` (nullable), `errorText`.
- Rule: amounts are always right-aligned monospace, two decimals on entry, thousands separators on
  display.
- Screens: M07-S03 ("money inputs with validation error state").

**Relation picker**
- Anatomy: a search/selected-value header row, a results list where each row is prefixed with a typed
  3-letter tag (ORG/CON/PRO/TNA…) in a bordered mono chip, plus a trailing "+ Create …" affordance row.
- Props implied: `query`, `results[{type, label, meta}]`, `allowCreate`.
- Screens: implicit in every relation field; not separately named in a screen annotation, but the
  organisation-match flow on M03-S02 ("Organisation{id,name,matchReason}") depends on it.

**Saved-view switcher**
- Anatomy: pill-group view switcher (with counts) + active filter chips row (dismissible, "✕") + a
  dashed "+ Filter" affordance + a bottom action row (Save view / Columns / Export).
- Props implied: `views[{label, count, active}]`, `filters[{label}]`.
- Screens: M03-S02/M03-S06 area ("pill tab group, filter chips" wording recurs across M02-S01, M12-S07,
  M13-S05).

**Empty / loading / error / confirm-destructive states** (grouped under §05 System surfaces in the
file, listed here for completeness since CLAUDE.md names them together with the controls set):
- Empty state: dashed border box, bold message + muted sub-line + a "Change rule"/"Clear filters"
  ghost button.
- Loading skeleton: stacked grey bars of varying width simulating text lines, with a divider between
  groups.
- Error state: red-tinted bordered box, bold error title, muted detail, a mono error-ref code, Retry +
  Report buttons.
- Confirm-destructive: white bordered card with elevated shadow, bold question, muted consequence
  text, a red "confirm" primary button + Cancel secondary.
- Screens: M03-S06/empty follow-ups ("empty state"), M10-S06 ("Request unlock (destructive, confirm
  modal)"), M13-S02 ("empty state" for payment history), generic list "No results" pattern (§3.5).

### 3.4 §04 Workflow steppers — horizontal family (= **LifecycleStepper**)

One progress vocabulary at four densities/variants, all sharing one dot vocabulary: filled=done,
ringed=current, hollow=pending, amber=blocked, red-with-slash=terminal negative (Lost/Cancelled/
Rejected), dashed=skipped.

- **Variant A — Record header, labelled, 32px row.** Full stage row with a 10px dot + connector line
  above each stage label + date, used as the primary chain view in a RecordHeader.
- **Variant B — Blocked/skipped/terminal, same component.** Demonstrates the same variant-A row
  rendering a skipped stage (dashed circle) and a terminal-negative stage (filled red circle with a
  white slash) without any new component.
- **Variant B2 — Blocked state.** A 3rd example showing an amber "blocked" dot mid-chain (HRDC claim
  blocked · 2 docs) with subsequent stages pending.
- **Variant C — In-table, 20px cell, tooltip on hover/focus.** A dense inline version (7–9px dots,
  1px connectors) that fits inside a table cell; the whole cell carries a `title` tooltip listing every
  stage's status, and cells are `tabindex="0"` so the tooltip is keyboard-reachable too.
- **Variant D — Inline chevron, drawers/cards/list rows under 320px wide.** A chevron-segmented mini
  breadcrumb-like strip (each stage a chevron-shaped label), current stage highlighted in the 10% tint.

Props implied (shared): `stages[{label, date, state: done|current|pending|blocked|skipped|terminal}]`.
Governing rule (verbatim): use Variant A in record headers, Variant C in any table, Variant D where
width is under 320px; never two variants for the *same object* on one screen (A for the record + C for
its related records in the same screen is correct). **Stage names and order render from pipeline
configuration** (referenced as living in Settings → M20-S07), never hardcoded — this is also stated as
a standing rule in the project `CLAUDE.md`.

Screens: M09-S02 ("LifecycleStepper (blocked + current states)"), Kit proof M04-S02 ("chain stepper
(variant A)" in header, variant C in the engagements table — explicitly documents "same object never
gets two variants" being followed).

### 3.5 §05 System surfaces

**Command palette (⌘K)**
- Anatomy: search input row (with a text cursor caret shown), grouped results ("Records" then
  "Actions" section headers), each record row typed with a mono 3-letter tag, one AI-flagged action row
  (✦ "Ask TrainOS about…", tagged "AI" at the row's right edge), a footer keybinding legend
  (↑↓ navigate · ↵ open · ⌘↵ open in drawer · esc close).
- Props implied: `query`, `groups[{label, items[{type,label,meta}]}]`.
- Screens: referenced structurally by the topbar search field on every screen (`K.topbar`'s ⌘K hint);
  no screen annotation names it explicitly as a rendered overlay.

**Agent-run card (AutomationRun)**
- Variants: succeeded run (green "Succeeded" chip, 4-metric grid [Trigger/Duration/Cost/Model], a
  step-by-step tool-call log with ✓/!/⏸ glyphs and durations, footer links + Retry button); failed run
  (red-bordered/tinted variant, "Failed · 3rd attempt" chip, single-line error code + explanation,
  Retry/Dismiss-to-dead-letter actions). REPORT.md confirms: "the failed variant is the row shape used
  by the failures queue (M18-S07) and the dead-letter list."
- Props implied: `agentName`, `runId`, `status`, `trigger`, `durationMs`, `costRM`, `model`,
  `steps[{tool, args, status, durationMs}]`, and for the failed variant `errorCode`, `retryCount`,
  `heldReason`.
- Screens: M18-S04 ("run rail with failed variant"), M13-S05 implicitly (Collections Agent failed-send
  scenario matches this card's failed variant).

**Provenance block** (mandatory on every AI element per the annotation text)
- Anatomy (2 lines, 6 facts, verbatim): line 1 = AI marker+confidence chip, agent+run+source-count,
  model/provider/cache-hit/tier (mono, right-aligned); line 2 = decision line — approved-by + role +
  timestamp + what was edited + "sources"/"trace" links. Nothing else belongs in this block; evidence
  and diffs live on the approval screen instead.
- 7 badge variants documented: **Human** (no visible badge — filter/audit only), **System** (grey pill,
  "generated by a rule/template, no model" — never violet), **✦ AI suggested · N%** (blue tint,
  drafted-not-acted), **✦ AI executed `AUTO`** (blue tint, heavier 1px solid border + AUTO tag — acted
  autonomously under policy), **✦ Awaiting approval** (amber pill — the wait itself is the state),
  **✦ Low confidence · N%** (blue tint chip with an amber dot — visually distinct from a normal AI
  badge), **✦ AI failed** (red/danger pill, always paired with Retry + "write manually" links).
- Screens: M03-S02, M05-S02, M07-S02 (provenance badges/line), M12-S07/M12-S08 (model+confidence+source
  span), M18-S04 (per-node model/tier/cache/cost — the provenance concept extended into trace nodes).

**Source-citation chip**
- Anatomy: superscript numbered chip (mono, blue-tinted) inline in AI-authored prose; clicking opens
  the cited source record in the audit drawer. Rule: uncited AI prose is not allowed on record pages.
- Screens: M03-S02 ("numbered source citations"), M05-S02 ("citation list"), M12-S07/M12-S08 (rule
  drawer / diff cards cite source spans the same way).

**Exception / SLA banner**
- Variants: danger (red, deadline/compliance risk, e.g. "HRDC grant window closes in 3 days"), warning
  (amber, SLA breach escalation), danger with a fix action ("Accounting sync failed … Fix mapping").
- Props implied: `severity`, `title`, `subtitle`, trailing action (button or link).
- Screens: M01-S01 ("banner"), M09-S02 ("warning banner"), M12-S02 ("danger banner"), M13-S02 ("info
  banner"), M16-S05/M20-S20/M20-S21 (warning/danger banners for stale sources, degraded tiers, invalid
  keys).

**Empty / loading / error / confirm-destructive** (4-up grid) — see §3.3 for anatomy; grouped here in
the source file under System surfaces rather than Controls.

### 3.6 §07 Shell — canvas, sidebar, top bar

- **Sidebar**: 3 role-variant previews shown (Sales Consultant, Finance Executive, System Admin) plus
  a collapsed rail variant (64px wide, flyout on hover). Built width is **240px** (see §1.4 dark-mode
  note on the 232 vs 240 discrepancy). Structure top-to-bottom: org identity row (26×26 logo box,
  org name + "APSB · TRAINOS" mono subtitle, two trailing icon affordances) → nav groups (see §2) →
  bottom-pinned user row (28×28 initials avatar circle, name+role, light/dark toggle pill).
- **Geometry proof (2× ruler)**: exact pixel coordinates for the active-parent-row anatomy, given as
  x-offsets against a 240px sidebar: x12→x228 parent row (36px tall, 8px radius), x20→x38 icon box
  (18px glyph, centred at x29), x29 tree connector line (1px `#CDD3DB`, spans parent-row bottom to
  last child dot), x42→x228 active-child white card (8px radius, `0 1px 2px rgba(0,0,0,.06)` shadow,
  starts 13px right of the tree line), x52 child dot centre (6px), x66 child label (18px right of the
  parent label at x48), x212 badge right edge. Badge tokens: `badge-default` = `#F4F7FF`/`#1849D6`;
  `badge-alert` = danger tint, applied only when the summed group contains a breached-SLA item.
- **Top bar**: 56px tall, breadcrumb trail (parent links in `sec`, current crumb bold in `ink`,
  `›` separators in `mut`) on the left; search box (180px, ⌘K hint) + notification bell (with a small
  red unread dot) + help "?" + language toggle chip (EN | BM) + user initials avatar on the right.
- **Card header / empty state / FAB**: every screen's single white content card sits on the canvas
  with a page-header row (title 22/600 + optional status chip + right-aligned action buttons), and can
  show a centred empty state (dashed icon, message, ghost action). The **FAB** ("Ask TrainOS") is a
  44×44px circular blue-tinted button, bottom-right, `position:absolute`, always present unless a
  screen opts out (`fab:false` in `K.screen`, e.g. locked/external screens).
- **Profile modal**: 960px wide, an 18px-radius card with a 320px left identity rail (176×176px avatar
  circle at −72px overlap, name 24/700, role pill in mono uppercase) and a right-hand field grid (Job
  title, Department, Email, Mobile, Staff no., Language & timezone, Data scope).

Screens: the shell (sidebar+topbar+card+FAB) is present on every internal screen; only M07-S07
(client-facing proposal) uses the **external minimal shell** variant instead (logo + language toggle +
contact info, no sidebar — a REPORT.md kit addition).

### 3.7 §08 Data table — full spec

"Every list screen in TrainOS is this component with different columns" (verbatim).
- **Header row**: title (22/600) + a count/scope chip (e.g. "My accounts · 48") + right-aligned action
  buttons (Columns / Export / New-record primary).
- **View + density row**: saved-view pill switcher (with counts) + search input + a Comfortable/Compact
  density segmented toggle.
- **Filter bar**: dismissible filter chips (`Label: value ✕`) + dashed "+ Filter" affordance + a
  trailing "N of M shown" counter, right-aligned.
- **Bulk-action bar** (appears only when ≥1 row selected): tinted (`tint2`) row, "N selected" label,
  a cluster of bulk buttons (Assign/Tag/Export/Archive in the sample), trailing "Clear" link.
- **Header cells**: mono uppercase 10px labels; sortable columns show `⇅`/`▾` + a `⏷` filter-menu
  affordance, muted until interacted with.
- **Body rows**: alternating zebra (`surf`) background; a selected row gets `tint2` background plus an
  `inset 2px 0 0 blue` left rule and a filled checkbox. Cell conventions: primary field bold + a muted
  11px sub-line beneath it (e.g. contact name + interest tag); money columns right-aligned mono;
  status/stage as a pill chip; a "Score" column rendered as a mini bar (44×5px track) + numeric label.
- **Column filter popover** (shown for an enum column "Stage"): bordered dropdown anchored under the
  header, listing each enum value as a checkbox row with a trailing count.
- **Compact density**: identical structure, row padding reduced (11px→6px vertical).
- **No-results state**: dashed-border empty box (same icon/message/action pattern as the generic empty
  state) plus a caption explaining the full filter taxonomy: text (contains/equals/starts with),
  number/money (RM range), date (today/7d/30d/custom), enum (multi-select with counts), relation
  (record picker), boolean. Sort/resize/column-visibility live in the header; the filter bar holds
  active chips.
- Props implied: `columns[{key,label,align,sortable,filterType}]`, `rows[{cells[],selected}]`,
  `savedViews[]`, `activeFilters[]`, `density`, `bulkActions[]`.

Screens: this is the base of every list screen — M02-S01 ("data table with grouped sections" — the
REPORT.md addition "grouped approval table" is this component plus urgency-group captions and a
disabled bulk-checkbox for money actions), M03-S01/S06, M06-S02, M12-S07, M13-S05, M18-S01, M20-S16,
M20-S20 all cite "data table" in their annotations.

### 3.8 §09 RecordHeader & MetricStrip

"One component, configured per entity. Row 1 identity + actions · Row 2 metadata · Row 3 metrics.
Breadcrumb stays in the top bar; identity is never repeated below" (verbatim — this is also the
CLAUDE.md standing rule "Record identity appears once per page").

- **1 · Default (Organisation config)**: identity row = 22/600 name + status chips (e.g. "Active
  client", "HRDC registered") + right-aligned action buttons (secondary/secondary/primary — one solid
  primary only); metadata row = mono 11px grey line (`ORG-0114 · Manufacturing · Shah Alam · owner
  Amirah · created 04 Mar 2024`); metrics row = MetricStrip (see below).
- **2 · Condensed — 48px, appears on scroll**: a sticky/condensed bar holding only 3 things — record
  name (14/600), the single most important status chip, and the primary action (plus any action the
  user can't afford to lose, e.g. "Request changes" + "Approve & send" together on an approval record).
  No toggle/chevron/accordion triggers it — it appears automatically once the full header scrolls
  past the top bar.
- **3 · Scroll transition rule**: metrics, metadata, lifecycle stepper and tabs are never pinned; focus
  does not move when the condensed bar activates (keyboard users unaffected). **Action availability
  rule**: the primary action stays reachable at every scroll position — on a 4,000px record, the
  primary is one keystroke away at the bottom.
- **4–6 · MetricStrip at 3, 5 and 6 cells**: the same cell component repeated at different counts
  (Organisation config = 5 cells: Lifetime value, Open pipeline, AR overdue, HRDC levy, Health;
  Programme config = 3 cells: Value, Participants, Trainer; Engagement config = 6 cells: Value,
  Sessions, Participants, Attendance, Evaluation — implied 6th not fully shown in this excerpt but
  matches M09-S02's "5 metrics incl. progress bar" wording elsewhere).
- **7–10 · Cell states**: Actionable-default (plain), Actionable-hover (`surface-hover` fill + a `›`
  chevron appears), Actionable-keyboard-focus (same chevron + a visible `0 0 0 2px blue` focus ring —
  so the affordance is never hover-only), Informational-only (no hover, no pointer, no chevron — "a
  cell with no meaningful drill-through gets no hover... behaviour, not decoration, tells you which
  numbers open something"). Documented drill-through targets: lifetime value → financial history,
  pipeline → filtered opportunities, AR → overdue invoices, levy → HRDC detail, health → score
  explanation, agent → run trace, confidence → evidence, margin → costing, risk → risk note.
- **11–13 · Same component, three entity configs**: demonstrates the identical RecordHeader/
  MetricStrip pair reused verbatim for an approval record ("Send proposal · Aurora Manufacturing Sdn
  Bhd") and a programme record ("Leading Development Programme · Aurora") — proving one component
  handles every entity type via configuration, not per-entity variants.

Props implied: `title`, `chips[]`, `metaLine` (mono), `actions[{label,kind}]` (max one `primary`),
`cells[{label, value, sub, actionable, drillTo, bar?}]`.

Screens: RecordHeader/MetricStrip is used on nearly every record page — M01-S01 ("5 actionable
cells"), M03-S02 ("4 metrics"), M05-S02 ("5 metrics"), M06-S02 ("5 metrics"), M07-S02/S03 ("5
metrics"), M09-S02 ("5 metrics incl. progress bar"), M10-S06, M12-S02 ("completeness bar" variant),
M13-S02 ("5 metrics"), M18-S04 ("5 metrics"), and Kit proof M04-S02 (the canonical "record pattern
every entity in the chain inherits": breadcrumb → title+status chips → identity line → MetricStrip →
chain stepper variant A → tabs → exception banner → relationship panels → right rail).

### 3.9 §10 AI operations components (added in the "update pass"; REPORT.md calls these out as its
own kit addition set)

**Tier chip**
- Variants: 5 named tiers (`FAST`, `MID`, `STRONG-1`, `DEEP THINK`, `SPECIAL`), each optionally paired
  with a model name (e.g. `FAST` + "DeepSeek V4 Flash", `STRONG-1` + "Claude Sonnet 5").
- Anatomy: neutral grey pill, mono uppercase tier key + optional muted model-name suffix. Deliberately
  neutral — "a tier is a routing fact, not a status."
- Screens: M18-S04, M20-S20 (both name "tier chip" explicitly).

**Jury chip · budget bar**
- Jury chip variants: `✦ Jury 2 of 3` (blue tint — jury ran) / `No jury` (grey/neutral).
- Budget bar variants: within budget (ink fill), near cap (amber/`warn` fill, e.g. 87%), at/over cap
  (danger fill, 100%). Anatomy: a spent/cap text row + a 5px track/fill bar; the bar stays ink until
  near or at cap, per the rule "budget bars stay ink until they near or hit a cap."
- Screens: M18-S04, M20-S16, M20-S20 (jury chip); M20-S16, M20-S20, M20-S21 (budget bar).

**Allowed-hours strip**
- Anatomy: 24 equal-width cells (one per hour, MYT), each shaded `tint2` (allowed) or a peach/amber
  `#F3E3C6` (peak · avoid); a 2-item legend beneath. Props implied: `bands[{startHour,endHour,kind}]`.
- Screens: M20-S20 ("data table with hour strip").

**Rule check row · citation chip**
- States: Pass (green), Warn (amber), Fail (red) — each row shows a verdict pill, the check label, a
  mono line of **computed values** (not just the verdict, e.g. "grant approved 28 Oct → earliest start
  11 Nov → training 12 Nov"), and a trailing citation chip (`§ HRD-014` style, mono, opens the rule
  drawer with its source excerpt). Deterministic checks are labelled "Computed · no model"; an
  interpreted check instead carries a model name + confidence.
- Screens: M12-S02, M09-S02 (both cite "rule check row"/"checks block with computed values and
  citation chips").

**Trace tree node**
- Anatomy: depth-indented rows (`└` connector per depth level), a status glyph (◆ orchestrator, ✓
  success, ⏸ halted, etc. — colour-coded), a title+meta two-line block (title bold at depth 0, regular
  deeper; meta line shows tier/cache-hit/plan info), a right-aligned mono cost/duration figure, and a
  trailing `▸` expand affordance. A halted node takes the AI tint background because "policy
  interception is the thing worth seeing." Depth communicates hierarchy, glyph communicates status,
  cost/tokens are always right-aligned.
- Screens: M18-S04 ("trace tree node", "execution tree — orchestrator → Reader/Matcher/Drafter/
  Verifier → tools").

**State-card panel**
- Anatomy: a fixed-width (330px) right-column panel with stacked labelled sections — Goal, Plan (a
  numbered step list with ✓/pending/halted markers inline), Open questions — plus a token-budget bar
  at the bottom. Exists because "a long orchestrator run is not a list of tool calls; it is a working
  memory that survives restarts" — this is the artifact a HANDOFF/restart carries forward, enabling
  replay-from-checkpoint. Placement rule: right column of the trace viewer only, never inside the tree
  (it's reference material, not part of execution).
- Full field set per the annotation data contract: `{goal, plan[], decisions[], constraints[],
  recordPointers[], openQuestions[], tokenBudget, costBudget}` (the rendered sample shows Goal/Plan/
  Open-questions/budget-bar; Decisions/Constraints/Record-pointers are in the data contract but not
  all visible in this particular sample render).
- Screens: M18-S04 ("state-card panel with goal, plan, decisions, constraints, open questions and
  budget bars").

**REPORT.md-listed additions not separately illustrated as standalone swatches in Kit.dc.html §10**
(they appear instead as compound arrangements inside specific screens, per REPORT.md's "Kit additions"
lists — cross-reference to the screens that use them):
- **MetricStrip mini bar** — a bar-augmented MetricStrip cell (`K.cell(..., {bar: pct})` in kit.js);
  used for health/attendance/claim-completeness metrics (M09-S02, M10-S06, M12-S02).
- **Grouped approval table** — the data table (§3.7) with urgency-group captions above table blocks and
  a disabled bulk-checkbox on rows that may not be bulk-approved (M02-S01).
- **Escalation ladder** — vertical dot list showing where agent autonomy ends and a human takes over
  (M13-S05 collections).
- **Document checklist row** — checklist item (§3.3) extended with a document thumbnail placeholder +
  metadata + attach/view action (M12-S02).
- **Run step row** — the tool-call log line inside the agent-run card (§3.6), shown standalone: tool
  call, arguments, outputs, duration, cost, status glyph, expandable (M18-S04 trace viewer).
- **Aging strip** — MetricStrip configured with AR ageing buckets (M13-S05).
- **External minimal shell** — see §3.6 (M07-S07).

Screens: this whole §10 set exists because of the "update pass — AI operations, BYOK, compliance
rules, orchestrator UX" documented in `REPORT.md`; its primary consuming screens are M18-S04, M20-S16,
M20-S20, M20-S21, M12-S02, M12-S07, M12-S08, M09-S02, M16-S05.

### 3.10 §06 Proof screens

Not components — a validation section containing 3 full screens (M03-S01 Enquiry inbox, M02-S02
Approval detail, M04-S02 Organisation 360) built *only* from the components defined in §01–05 and
§07–10, proving the kit is sufficient before any module screen was drawn. Their annotations use a
different, shorter field set than the module screens (Purpose / Primary user / Key actions / AI
behaviour or Structure-to-reuse / Click budget / Open questions) — see §4 and §8.

---

## 4 · Screen inventory

27 screen ids exist across the pack: 24 in the 13 numbered module files + their titles, plus 3 "proof"
screens embedded in `Kit.dc.html`. (REPORT.md's own count of "20 screens across 13 files" plus its
"six new screens" from the update pass totals 25 tracked screens; the pack actually contains 26 module
+ 3 kit-proof = wait — precise reconciliation and the one undocumented screen are covered in §8.)

Data below is extracted verbatim from each screen's `<details>` annotation panel (`Purpose`, `Primary
user`, `Components used`, `Data contract`, `Actions & policy gates`, `States rendered`, `AI & approval
behaviour`, `Wired to`, `Assumptions` for module screens; the 3 Kit proof screens use a different field
set, noted per-row). "Primary button" is taken from the annotation's `Actions & policy gates` field —
where a screen explicitly has none (locked state), that is stated as such.

### M01 · Dashboards

| Field | Value |
|---|---|
| Screen id | M01-S01 |
| Title | Executive dashboard |
| File | `M01 Dashboards.dc.html` (dark twin: `Dark M01 Dashboards.dc.html`) |
| Primary user | Dato' Lim (MD); Sales Manager and Finance also read it |
| Primary button | "Open approvals" is the only primary — every other metric drills through but doesn't act; no money moves on this screen |
| States rendered | AR-overdue metric carries a warning delta + banner; one approval row is SLA-breached (danger) |
| Components used | Page header, MetricStrip (5 actionable cells), banner, section pattern, data table, bar chart, approval list |
| Wired to | Metrics → filtered lists · Approvals → M02-S01 · Agent registry → M18-S01 · AR banner → M13-S05 |
| Data contract (verbatim) | `Metric{key,label,value,delta,drillTo} · AgentDaily{agent,actionsToday,autonomy,costMonthRM,evalScore} · ApprovalRequest{id,type,subject,valueRM,slaRemaining,severity}` |
| Assumptions | Admin hours saved = agent actions × role-weighted manual minutes, shown as an estimate (superseded by DECISIONS.md §4 — see §7). MD sidebar variant shows Home, Sales, Relationships, Finance, Automation, Reports |

### M02 · Approvals

| Field | Value |
|---|---|
| Screen id | M02-S01 |
| Title | Approval inbox |
| File | `M02 Approvals.dc.html` (dark: `Dark M02 Approvals.dc.html`) |
| Primary user | Kelvin (Sales Manager); MD sees items above RM 50,000 |
| Primary button | Row action "Open" (⏎) → M02-S02. Bulk approve is disabled while any money action is selected |
| States rendered | One SLA-breached row (danger, checkbox disabled); one compliance item warning on a 3-day window |
| Components used | Page header, pill tab group, filter chips, data table with grouped sections, autonomy chips, AI badges, keyboard hint bar |
| Wired to | Row → M02-S02 · Breaching row → discount approval · HRDC row → M12-S02 · Invoice row → M13-S02 |
| Data contract | `ApprovalRequest{id,policyId,type,subject,valueRM,requestedBy{kind,agentId\|userId},confidence,slaDueAt,autonomyLevel,status}` |
| Assumptions | Grouping is by SLA urgency (breaching / today / this week); median decision time is a live measure from the audit log |

| Field | Value |
|---|---|
| Screen id | M02-S02 (kit-proof format — no module file; appears only as `Kit.dc.html` §06) |
| Title | Approval detail — send proposal |
| File | `Kit.dc.html` (id `proof-m02s02`) |
| Primary user | Sales Manager (Kelvin); MD above RM 50,000 |
| Key actions (proof format) | Approve & send, Request changes, Reject. Queue rail keeps the next 6 items one keystroke away |
| Structure to reuse | One vertical narrative: why you are here → recommendation → evidence and risk → what changes if you approve. The consequence block is the only bordered element, because it answers the approver's real question. Discount/trainer-rate/invoice/HRDC approvals swap only the preview pane |
| Click budget | Approve from inbox = 2 clicks or 1 keystroke; full enquiry→sent-proposal path = 5 of a 6-click budget |
| Open questions | Should Request changes require a reason before submit? Does a soft-held trainer slot release automatically at 72h or need a decision? |

### M03 · Leads

| Field | Value |
|---|---|
| Screen id | M03-S01 (kit-proof format — no module file) |
| Title | Unified enquiry inbox |
| File | `Kit.dc.html` (id `proof-m03s01`) |
| Primary user | Sales Consultant (Amirah); Sales Manager watches unassigned count |
| Key actions | Triage, assign, convert to lead, archive non-enquiries |
| AI behaviour | Lead Agent classifies, extracts intent, matches organisation, proposes next step at Act-with-approval. Low-confidence (<60%) items are flagged for human classification, never auto-archived |
| Click budget | Enquiry → converted opportunity = 2 clicks; leaves 4 of the 6-click budget for proposal build + approval |
| Open questions | Should auto-archive at >90% confidence be autonomous or Suggest-only for the first quarter? Does WhatsApp inbound need a 24h service-window timer on the row? |

| Field | Value |
|---|---|
| Screen id | M03-S02 |
| Title | Enquiry detail |
| File | `M03 Leads.dc.html` (dark twin present) |
| Primary user | Amirah (Sales Consultant) |
| Primary button | "Accept & convert" — creates OPP-0512 + TNA-0042; conversion itself is not policy-gated (the later proposal send is) |
| States rendered | Timing field shown mid-edit ("Edit before use"); overdue-invoice exception on the account |
| Components used | RecordHeader (4 metrics), section flow, AI provenance line with numbered source citations, relation list, exception banner, assistant pill |
| Wired to | Accept & convert → M05-S02 (TNA) · Aurora → M04-S02 · INV-2026-0288 → M13-S05 |
| Data contract | `Enquiry{id,channel,receivedAt,from,body,status} · Extraction{topic,audience,timing,budget,confidence,sources[],agent,runId} · Organisation{id,name,matchReason} · SuggestedAction{type,payload,autonomy}` |
| Assumptions | Domain match auto-links an organisation at ≥90% confidence; below that a picker opens |

| Field | Value |
|---|---|
| Screen id | M03-S06 |
| Title | Follow-up queue |
| File | `M03 Leads.dc.html` (same file as M03-S02; dark twin present) |
| Primary user | Amirah (Sales Consultant) |
| Primary button | "Send" (human-triggered) — nothing sends autonomously at Suggest level |
| States rendered | Two overdue rows (danger); one selected row; consent line proving PDPA check before send |
| Components used | Page header, pill tab group, data table, AI panel, WhatsApp cost strip, chips |
| Wired to | Row → M04-S02 / M07-S02 · Send → activity timeline on the record |
| Data contract | `FollowUp{id,contactId,reason,dueDate,status,autonomy} · MessageDraft{channel,templateId,category,ratePerMsgRM,recipients,body,consentOk}` |
| Assumptions | WhatsApp Utility RM 0.0564 and Marketing RM 0.3467 are rate-card values held in Settings → Integrations |
| **Note** | This screen is **not mentioned anywhere in `REPORT.md`, `DECISIONS.md` or `CLAUDE.md`** — see §8 |

### M04 · (Organisation — no standalone module file; kit-proof only)

| Field | Value |
|---|---|
| Screen id | M04-S02 |
| Title | Organisation 360 |
| File | `Kit.dc.html` (id `proof-m04s02`) — no `M04 *.dc.html` module file exists in the pack |
| Primary user | (canonical record pattern — no single named user) |
| Key actions | (n/a — this is the reused record template, not a task screen) |
| Record pattern (verbatim) | Breadcrumb → title + status chips → identity line → metric strip → chain stepper (variant A) → tabs → exception banner → relationship panels → right rail with assistant, activity and related records |
| Chain position | Parent: none. Children: Contact, Enquiry, Opportunity, TNA, Proposal, Engagement, Participant, Certificate, HRDC claim, Invoice, Payment, Renewal — all reachable from this page |
| Stepper rule in practice | Variant A in the header for the current engagement; variant C in the engagements table for other objects. Same object never gets two variants |
| States shown | Overdue invoice with a drafted AI reminder; HRDC claim blocked on documents; a grant deadline in 3 days; a lost engagement with TNA skipped; a contact with no PDPA consent |
| Open questions | Is health score a field or a computed measure users can drill into? Should the levy figure be entered by Finance or pulled from the last claim statement? |

### M05 · TNA

| Field | Value |
|---|---|
| Screen id | M05-S02 |
| Title | TNA detail |
| File | `M05 TNA.dc.html` (dark twin present) |
| Primary user | Amirah (Sales Consultant); Sales Manager reviews before pricing |
| Primary button | "Use recommendation" (seeds the proposal); no policy gate at this step |
| States rendered | Budget-not-stated rendered as a real absence, not zero; third programme shown at 22% fit for an honest ranking |
| Components used | RecordHeader (5 metrics), data table, AI panel, ranked cards with fit bars, chip row, citation list |
| Wired to | Use recommendation → M07-S02 · Programme name → M06-S02 · Evidence → source records |
| Data contract | `TNA{id,opportunityId,status,audience{headcount,level,sites,language},constraints[],completedBy,completedAt} · Gap{name,evidenceRefs[],priority,confidence} · Recommendation{programmeId,fitScore,rationale,trainerAvailability}` |
| Assumptions | Fit score = weighted match of gap coverage, audience size, delivery window, trainer availability; weights live in Settings |

### M06 · Programmes

| Field | Value |
|---|---|
| Screen id | M06-S02 |
| Title | Programme detail |
| File | `M06 Programmes.dc.html` (dark twin present) |
| Primary user | Amirah (Sales) views; L&D owns edits |
| Primary button | "Edit programme" (L&D only) — pricing edits are role-gated to Finance + L&D |
| States rendered | One trainer already booked in the requested window (the constraint that later makes the M02 approval "Medium risk") |
| Components used | RecordHeader (5 metrics), section pattern, three data tables, chip row, document placeholders |
| Wired to | From M05-S02 recommendation · Trainer → M08-S02 (no M08 module file in this pack) · Floor price feeds M07-S03 validation |
| Data contract | `Programme{id,name,category,days,version,listPriceRM,hrdcScheme,outcomes[],modules[],pricingTiers[],floorPriceRM} · Delivery{clientId,dates,pax,evaluation,valueRM} · TrainerLink{trainerId,certified,rating,availability}` |
| AI & approval behaviour | None — deliberately human-maintained catalogue; "not every screen needs an agent" |
| Assumptions | Sales sees this page read-only in production even though Edit is drawn enabled here |

### M07 · Proposals

| Field | Value |
|---|---|
| Screen id | M07-S02 |
| Title | Proposal builder |
| File | `M07 Proposals.dc.html` (dark twin present) |
| Primary user | Amirah (Sales Consultant) |
| Primary button | "Send for approval" (triggers policy APV-01) |
| States rendered | Section 5 at 41% confidence blocks a clean send; section 3 shows "AI-assisted · edited" |
| Components used | RecordHeader, section list rail, provenance badges, merge-field chips, warning banner, live preview panel |
| Wired to | Send for approval → M02-S01/M02-S02 · Margin → M07-S03 · Run #4821 → M18-S04 |
| Data contract | `Proposal{id,opportunityId,templateId,status,sections[{n,title,body,origin,confidence,editedBy}],valueRM,marginPct,runId} · Template{id,version,mergeFields[]}` |
| Assumptions | Low-confidence sections warn rather than hard-block; flag travels to the approver |

| Field | Value |
|---|---|
| Screen id | M07-S03 |
| Title | Quotation & costing worksheet |
| File | `M07 Proposals.dc.html` |
| Primary user | Amirah (Sales); Sales Manager on discount approval; Finance owns the rate card |
| Primary button | "Apply to proposal" — a below-floor price cannot apply without a discount approval (policy APV-02) |
| States rendered | Discount field in the below-floor error state; venue at zero (client site) |
| Components used | RecordHeader (5 metrics), data table, money inputs with validation error state, margin gauge, section pattern |
| Wired to | Apply → M07-S02 · Below-floor path → M02-S03 discount approval (no M02-S03 file in this pack) · Rate card → Settings |
| Data contract | `Quotation{id,proposalId,lines[{item,detail,qty,rateRM,totalRM}],sellRM,directCostRM,marginPct,floorPriceRM,commissionPct} · RateCard{year,trainerDayRM,materialsPerPaxRM,travelPerDayRM}` |
| AI & approval behaviour | None — costing is deterministic; the agent reads this worksheet but doesn't set price |
| Assumptions | Commission 8% of sell, payable on collection; floor price = cost ÷ (1 − 0.35). Both later flagged "rate card v0 · placeholder" per DECISIONS.md §5 |

| Field | Value |
|---|---|
| Screen id | M07-S07 |
| Title | Client-facing proposal page |
| File | `M07 Proposals.dc.html` |
| Primary user | Nurul Hassan (HR Manager, Aurora Manufacturing) |
| Primary button | **None, locked** — this is the accepted/locked state (before acceptance the primary would be "Accept proposal", replaced by "Download signed copy" once accepted) |
| States rendered | Accepted and locked — the deliberate non-happy-path state, since editable is the common case |
| Components used | External minimal shell, page header with status chip, info banner, document sections, comment thread, acceptance panel |
| Wired to | Acceptance → OPP-0512 Won → ENG-0231 (M09-S02) · comments post to the internal activity timeline |
| Data contract | `PublicProposal{token,proposalId,sections[],investment{totalRM,hrdcScheme,levyAvailableRM},status,acceptedBy,acceptedAt,signatureRef} · Comment{author,role,body,createdAt}` |
| AI & approval behaviour | No AI surfaces client-side; provenance stays internal |
| Assumptions | E-signature = name + timestamp + IP, not certificate-based; deemed sufficient for HRDC purposes |

### M09 · Operations

| Field | Value |
|---|---|
| Screen id | M09-S02 |
| Title | Engagement detail |
| File | `M09 Operations.dc.html` (dark twin present) |
| Primary user | Siti (Operations Coordinator); Finance and MD read it |
| Primary button | "Close out" — blocked until claim documents are complete |
| States rendered | Claim blocked with 2 missing documents; two partial-attendance participants; deadline warning banner |
| Components used | RecordHeader (5 metrics incl. progress bar), LifecycleStepper (blocked+current states), pill tabs, warning banner, two data tables, checklist, finance panel |
| Wired to | Open packet → M12-S02 · Attendance metric → M10-S06 · INV-2026-0311 → M13-S02 · Trainer → M08-S02 |
| Data contract | `Engagement{id,opportunityId,programmeId,dates[],venue,owner,status,valueRM} · Session{id,day,date,venue,trainerId,present,total} · Participant{id,name,dept,attendance{d1,d2},status} · Checklist{item,done} · ClaimStatus{completenessPct,missingDocs[]}` |
| Assumptions | Close out requires attendance locked + evaluation summary + certificates; button stays visible but disabled until then |

### M10 · Participants

| Field | Value |
|---|---|
| Screen id | M10-S06 |
| Title | Attendance capture |
| File | `M10 Participants.dc.html` (dark twin present) |
| Primary user | Siti (Ops); trainer signs the declaration; Finance consumes the export |
| Primary button | **None, locked** — nothing may be written in this state; screen offers Export/Request-unlock instead |
| States rendered | Locked state shown; capture controls disabled; one participant absent both sessions with a recorded reason |
| Components used | RecordHeader, locked chip, neutral lock banner, pill tabs for days, dense data table, disabled capture controls, lock trail |
| Wired to | Export → M12-S02 claim packet · Unlock → confirm-destructive modal → audit log |
| Data contract | `AttendanceSheet{engagementId,day,status:locked,approvedBy,approvedAt} · AttendanceRow{participantId,amPresent,amTime,pmPresent,pmTime,signatureRef} · UnlockRequest{reason,requestedBy,voidsClaim:true}` |
| AI & approval behaviour | None — deliberately kept free of agent involvement; attendance is evidence, not inference |
| Assumptions | Sessions are AM/PM per day matching the HRD Corp sheet; signatures captured on-device as image refs |

### M12 · HRD Corp

| Field | Value |
|---|---|
| Screen id | M12-S02 |
| Title | HRD Corp grant & claim packet |
| File | `M12 HRD Corp.dc.html` (dark twin present) |
| Primary user | Jason (Finance Executive); Ops supplies documents |
| Primary button | "Mark as submitted on eTRIS" — disabled until complete; records a human-entered reference |
| States rendered | Two missing documents; a 3-day deadline in danger; primary disabled + an agent suggestion to close the gap |
| Components used | RecordHeader with completeness bar, danger banner, document checklist with previews, submission log, info banner, disabled primary, AI panel |
| Wired to | Attendance → M10-S06 · Tax invoice → M13-S02 · Approve reminder → M02-S01 · Engagement → M09-S02 |
| Data contract | `ClaimPacket{engagementId,scheme,employerCode,claimValueRM,completenessPct,requiredDocs[{type,status,ref,meta}],deadlineAt,status} · SubmissionLog{action,actor,reference,at}` |
| Assumptions (as drawn) | SBL-Khas claim window 5 working days after completion; grant GRT-2026-77412 already approved before delivery. **Superseded** — DECISIONS.md §3 corrects this to a 6-month claim window and updates the on-screen banner/citation to Circular 2/2026 per the "Screen edits from these decisions" list |

| Field | Value |
|---|---|
| Screen id | M12-S07 |
| Title | HRD Corp rules registry |
| File | `M12 HRD Corp.dc.html` (dark twin present) |
| Primary user | Finance and Compliance; Ops reads it from a citation chip |
| Primary button | "Add rule" — activating a proposed rule is Act-with-approval |
| States rendered | One superseded rule with a dated, proposed replacement; one proposed rule awaiting verification |
| Components used | Page header, pill tabs, filter chips, data table, rule drawer with quoted source span, lineage, change history |
| Wired to | Citations from M12-S02 and M09-S02 open this drawer · Source → M16-S05 · Proposed → M12-S08 |
| Data contract | `ComplianceRule{id,scheme,subject,expression,effectiveFrom,effectiveTo,sourceDocumentId,sourceSection,sourcePage,sourceExcerpt,status,supersedesId,supersededById,verifiedBy,verifiedAt}` |
| Assumptions | Rule expressions are a small declarative grammar (field, operator, offset) evaluated deterministically; the model extracts, never evaluates |
| **Note** | Added in the REPORT.md "update pass"; not present in the original 19-screen table |

| Field | Value |
|---|---|
| Screen id | M12-S08 |
| Title | Rule change review |
| File | `M12 HRD Corp.dc.html` (dark twin present) |
| Primary user | Finance/Compliance — Act-with-approval, nothing activates silently |
| Primary button | "Approve selected" |
| States rendered | One change affecting 4 open engagements, called out before approval |
| Components used | RecordHeader, split document/diff layout, highlighted source span, add-modify-supersede cards with provenance, warning banner |
| Wired to | Approved → M12-S07 registry · Affected engagements → M09-S02 · Document → M16-S05 |
| Data contract | `RuleChangeSet{documentId,publishedAt,ingestedAt,extractedBy{model,confidence},effectiveFrom,changes[]} · RuleChange{op:"ADD"\|"MODIFY"\|"SUPERSEDE",targetRuleId,before,after,sourceSpan{page,section,excerpt},confidence,affectedEngagementIds[]}` |
| Assumptions | Ingestion proposes, never activates; confidence <0.80 is held for manual transcription rather than shown as a diff |

### M13 · Finance

| Field | Value |
|---|---|
| Screen id | M13-S02 |
| Title | Invoice detail |
| File | `M13 Finance.dc.html` (dark twin present) |
| Primary user | Jason (Finance Executive) |
| Primary button | "Record payment" — creating an invoice is policy-gated (FIN-01), recording a payment is not |
| States rendered | Validated now, with an earlier CUSTOMER_NOT_MAPPED failure kept in a collapsed row; payment history empty |
| Components used | RecordHeader (5 metrics), data table, sync log with collapsed error attempt, sync chips, empty state, info banner, relation list |
| Wired to | ENG-0231 → M09-S02 · HRDC → M12-S02 · Collections → M13-S05 · mapping fix → Settings → Integrations |
| Data contract | `Invoice{id,orgId,engagementId,issuedAt,dueAt,lines[],totalRM,sstRM,status,syncState,uin} · SyncEvent{at,state,detail,errorCode} · Payment{at,amountRM,method}` |
| AI & approval behaviour | None on the invoice itself; the Collections Agent appears only on the overdue sibling invoice |
| Assumptions | Training services are SST-exempt; UIN shown masked (issued by MyInvois, not TrainOS) |

| Field | Value |
|---|---|
| Screen id | M13-S05 |
| Title | Collections queue |
| File | `M13 Finance.dc.html` (dark twin present) |
| Primary user | Jason (Finance Executive); MD approves the trading hold |
| Primary button | "Approve & send" (policy FIN-03) — nothing sends without a human at this autonomy level |
| States rendered | One 48-day item already escalated to a human call (agent stops by rule); 31–60-day bucket in danger |
| Components used | Page header, MetricStrip (aging), pill tabs, data table, AI draft panel, channel pills, WhatsApp cost note, escalation ladder |
| Wired to | Row → M13-S02 · Approve → M02-S01 audit entry · Org → M04-S02 |
| Data contract | `Receivable{invoiceId,orgId,daysOverdue,amountRM,stage,nextActionAt} · ReminderDraft{stage,channel,templateId,body,recipients,consentOk,costRM} · EscalationRule{stage,triggerDays,channel,autonomy,approverRole}` |
| Assumptions | Reminder cadence 7/30/45 days, human call at 60, trading hold at 75 with MD approval — configurable in Settings → Approval policy |

### M16 · Knowledge

| Field | Value |
|---|---|
| Screen id | M16-S05 |
| Title | Knowledge sources |
| File | `M16 Knowledge.dc.html` (dark twin present) |
| Primary user | System Admin; Compliance follows the changed-source link |
| Primary button | "Add source" |
| States rendered | One changed source; one embedding pending; one fetch failing since 07 Nov |
| Components used | Page header, MetricStrip (6 cells), warning banner, data table with status chips, policy notes |
| Wired to | Changed → M12-S08 · Cited documents → M12-S07 rule drawer · Chunks → search index stats |
| Data contract | `KnowledgeSource{id,name,type,version,ingestedAt,chunks,embeddingStatus,lastCheckedAt,monitorStatus,contentHash,retrievalScopes[]}` |
| Assumptions | Weekly hash-based monitoring; internal SOPs retrievable for staff answers but excluded from client-facing generation |
| **Note** | Added in the update pass; not in the original 19-screen table |

### M18 · Agents

| Field | Value |
|---|---|
| Screen id | M18-S01 |
| Title | Agent registry |
| File | `M18 Agents.dc.html` (dark twin present) |
| Primary user | System Admin; MD approves autonomy promotions |
| Primary button | "Register agent" — promotions are policy-gated to the MD; a kill switch per agent is immediate and audited |
| States rendered | Knowledge Agent paused after an eval regression, with reason + resume condition stated |
| Components used | Page header, MetricStrip (6 cells), pill tabs, data table with per-action autonomy chips, toggle controls, warning banner |
| Wired to | Agent → M18-S02 (no file) · Last run → M18-S04 · Approvals raised → M02-S01 · Evals → M18-S05 (no file) |
| Data contract | `Agent{id,name,status,scopes[],costMonthRM,evalScore,lastRunAt,killSwitch} · AutonomyGrant{agentId,actionType,level,approverRole,thresholdRM}` |
| Assumptions | Money-moving action types cannot be set Autonomous; the ladder caps send/book/invoice at Act-with-approval |

| Field | Value |
|---|---|
| Screen id | M18-S04 |
| Title | Run / trace viewer |
| File | `M18 Agents.dc.html` (dark twin present) |
| Primary user | System Admin; approvers arrive here from an approval |
| Primary button | "Open approval" |
| States rendered | Halted at policy with the jury result recorded; a failed run in the rail with a live checkpoint |
| Components used | RecordHeader (5 metrics), run rail with failed variant, trace tree node, event rows, state-card panel, budget bars, tier chip, jury chip |
| Wired to | Open approval → M02-S02 · Tier → M20-S20 · Cost → M20-S16 · Agent → M18-S01 |
| Data contract | `AutomationRun{id,orchestrator,trigger,status,durationMs,cost,tokens,cacheHitRate,tiersUsed[]} · TraceNode{id,parentId,kind:"ORCHESTRATOR"\|"SUB_AGENT"\|"TOOL",name,tier,model,provider,tokens,cacheHitRate,cost,durationMs,status,haltedBy?} · RunEvent{type:"ESCALATION"\|"JURY"\|"TRUNCATION"\|"HANDOFF"\|"CHECKPOINT"\|"POLICY_HALT",detail,at} · StateCard{goal,plan[],decisions[],constraints[],recordPointers[],openQuestions[],tokenBudget,costBudget}` |
| Assumptions | Per-run token/cost budgets trigger a HANDOFF and restart at 60% context rather than truncation; checkpoints written after each sub-agent completes |

### M20 · Settings AI (all three added in the update pass)

| Field | Value |
|---|---|
| Screen id | M20-S20 |
| Title | AI models — tiers and routing |
| File | `M20 Settings AI.dc.html` (dark twin present) |
| Primary user | System Admin; MD approves cap raises |
| Primary button | "Apply to future runs" — never retroactive |
| States rendered | One tier degraded with the live fallback named; one paused by cap; two unsaved matrix edits |
| Components used | Page header, MetricStrip, warning banner, data table with hour strip and budget bar, assignment matrix, tier chip, jury chip |
| Wired to | Provider keys → M20-S21 · Usage → M20-S16 · Fallbacks fired → M18-S04 filtered runs |
| Data contract | `ModelTier{key,model,provider,routing:"THROUGHPUT"\|"PRICE"\|"FIXED",fallbackChain[],cacheStrategy,maxOutputTokens,allowedHours[],monthlyCap:Money,spend:Money,status} · ActionRouting{actionType,tierKey,escalationLadder[],juryEnabled,juryQuorum}` |
| Assumptions | Peak bands 09–12 & 14–18 MYT reflect DeepSeek pricing; batch-eligible tiers restricted to off-peak; changes apply to future runs only |

| Field | Value |
|---|---|
| Screen id | M20-S21 |
| Title | Provider keys — BYOK |
| File | `M20 Settings AI.dc.html` (dark twin present) |
| Primary user | System Admin only; Finance sees spend through Usage |
| Primary button | "Add provider key" (opens a drawer: provider, key, label, scope, cap, billing owner, residency note) |
| States rendered | One invalid key with a live fallback named; one at 90% of cap; one expiring; one first-run empty state |
| Components used | Page header, MetricStrip, danger banner, provider cards with masked key, tier chips, budget bar, dashed empty state |
| Wired to | Tier chips → M20-S20 · Spend → M20-S16 · Audit → audit log |
| Data contract | `ProviderKey{id,provider,status,maskedKey,scopeTiers[],spendMonth:Money,cap:Money,rotationDate,billingOwner:"CLIENT"\|"PASS_THROUGH",region,lastTestedAt,addedBy,rotatedBy}` |
| Assumptions | Keys stored encrypted, never returned in full by the API; residency shown per provider (PDPA) |

| Field | Value |
|---|---|
| Screen id | M20-S16 |
| Title | Usage, cost and budgets |
| File | `M20 Settings AI.dc.html` (dark twin present) |
| Primary user | System Admin; Finance and MD read it, MD approves cap raises |
| Primary button | "Raise SPECIAL cap" (Act-with-approval by the MD) |
| States rendered | SPECIAL paused by cap with a one-click raise; Compliance: rule-extract at 98%; forecast still inside cap |
| Components used | Page header, MetricStrip (6 cells), horizontal bar lists, stacked peak chart, data table with budget bars, raise-cap action |
| Wired to | Drill-through → M18-S04 filtered runs · Tiers → M20-S20 · Keys → M20-S21 |
| Data contract | `UsagePeriod{period,llmSpend,forecast,whatsapp{utility,marketing,cost},compute,cacheHitRate,offPeakShare} · CostBreakdown{dimension:"TIER"\|"AGENT"\|"ACTION_TYPE",key,spend,drillTo} · BudgetCap{scope,key,cap,spend,state:"WITHIN"\|"NEAR"\|"PAUSED"}` |
| Assumptions | Forecast linear on the trailing 7 days; cache savings estimated as cached-tokens × the tier rate that would otherwise apply |

### M22 · Demo script

| Field | Value |
|---|---|
| Screen id | M22-S04 |
| Title | Demo script |
| File | `M22 Demo script.dc.html` — **no dark twin exists** (`Dark M22 Demo script.dc.html` is absent from the pack) |
| Primary user | (document, not a role-scoped screen) |
| Primary button | None, document — "19 steps · about 12 minutes · one continuous story" |
| States rendered | — |
| Components used | Not documented — **this screen has no `<details>` annotation panel at all** (see §8) |
| Wired to | Every screen — it is an index/script linking the 19-step demo path across M01, M02, M03, M04, M05, M06, M07, M09, M10, M12, M13, M18 (confirmed by direct id references inside the file) |
| Data contract | Not documented |

---

## 5 · Layout patterns

**Shell dimensions** (see also §1.4, §3.6):
- Canvas / artboard: 1440×900 px per screen.
- Sidebar: built at 240px wide (Foundations panel text says 232px — discrepancy, §8); collapsed rail
  64px with hover flyout.
- Top bar: 56px tall.
- Content card: sits inside the canvas with a 14px margin on the right/bottom (from `K.screen`'s
  inline layout: `margin:0 14px 14px 0`), 14px border radius, `0 1px 2px rgba(0,0,0,.04)` shadow.
- External minimal shell (M07-S07 only): 56px top bar (logo, org name, language toggle, contact info),
  no sidebar, content card margin `0 14px 14px` on all sides.

**Page templates observed** (with representative screens):
1. **List + filter bar** (Data table, §3.7) — M02-S01, M03-S01, M03-S06, M06-S02 (3 tables), M12-S07,
   M13-S05, M16-S05, M18-S01, M20-S16, M20-S20.
2. **Record page** (RecordHeader + MetricStrip + tabs/sections, §3.8) — M03-S02, M04-S02 (canonical),
   M05-S02, M06-S02, M07-S02, M09-S02, M10-S06, M12-S02, M13-S02, M18-S04.
3. **Two-pane detail / split document-diff layout** — M12-S08 (document pane + diff cards with a
   highlighted, matching source span between the two panes).
4. **Document/editor** — M07-S02 (proposal builder: section list rail + live preview panel),
   M07-S03 (costing worksheet: line-item table + margin gauge).
5. **Settings matrix** — M20-S20 (tier table + a 12-row action↔tier assignment matrix, noted in
   REPORT.md's self-review as needing its own scroll pane since it didn't fit 900px), M20-S21
   (3-column provider-card grid), M18-S01 (per-action autonomy matrix as table columns).
6. **External/public page** — M07-S07 only, using the external minimal shell instead of the app shell.
7. **Locked/read-only record** — M10-S06, M07-S07 (both intentionally carry **no** primary button per
   REPORT.md: "M07-S07 and M10-S06 intentionally have none — both are locked states").
8. **Trace/orchestration viewer** — M18-S04 (run rail + trace tree + state-card right rail — a
   distinct template combining §09 RecordHeader with §10 AI-ops components).

Scroll and density behaviour called out by name: RecordHeader condenses to a 48px sticky bar past a
scroll threshold (§3.8); data tables offer a Comfortable/Compact density toggle (§3.7); very tall
matrices (M20-S20) get their own internal scroll pane rather than being truncated, with the page-level
banner kept outside that scroll flow (per REPORT.md's self-review notes).

---

## 6 · Fixture data (recurring entities — keep mocks consistent with these)

### 6.1 Organisations

| Name | Id | Notes |
|---|---|---|
| Aurora Manufacturing Sdn Bhd | ORG-0114 | The pack's primary demo client ("Aurora story", Sep–Nov 2026); also referred to as "Aurora HQ Shah Alam", "Aurora Mfg" (accounting-sync context), industry Manufacturing, owner Amirah, created 04 Mar 2024. Lifetime value RM 214,300; open pipeline RM 18,500; AR overdue RM 12,400 (34 days); HRDC levy RM 61,000 (expires 31 Dec); health score 74/100 |
| Aurora Precision Tooling | — | A second, similarly-named org shown in the Relation-picker sample flagged "possible dup" — a deliberate duplicate-detection fixture |
| Kenanga Retail Group | — | Lead example — "Sales Excellence" deal, RM 67,200, stage varies by sample (New/Qualifying) |
| Meridian Logistics | — | "Data Literacy" deal, RM 42,000, engagement ENG-0228 in the LifecycleStepper §04 example (HRDC claim blocked) |
| Sutera Hospitality | — | "Conflict to Collaboration" deal, RM 9,800, engagement ENG-0203, a **Lost** deal example (TNA skipped — repeat client) |
| Perdana Utilities | — | "Sales Excellence"/safety deal, RM 27,300, Negotiation stage |

### 6.2 People

| Name | Role | Notes |
|---|---|---|
| Dato' Lim | Managing Director (MD) | Also written "Dato' Lim" / "Dato' Lim"; approves items >RM 50,000, cap raises, autonomy promotions |
| Amirah (Yusof) | Sales Consultant | Primary user on M03-S01/S02/S06, M05-S02, M06-S02, M07-S02/S03; avatar initials "AY" |
| Kelvin (Tan) | Sales Manager | Approver on M02-S01/S02; escalation target for SLA breaches |
| Siti (Rahman) | Operations Coordinator | Primary user M09-S02, M10-S06 |
| Jason (Lee) | Finance Executive | Primary user M12-S02, M13-S02, M13-S05 |
| Nurul Hassan | HR Manager, Aurora Manufacturing | Client-side contact; primary user of the external M07-S07 page |
| Farah Aziz | Trainer | Named on the M09/M06 trainer-assignment fixtures |
| Lim Wei Sheng, Faridah Omar, Ganesh Pillai | Leads / contacts | Data-table row fixtures in the Kit §08 sample |

### 6.3 Records / ids

| Entity | Id(s) | Appears in |
|---|---|---|
| Opportunity | OPP-0512 | M03-S02, Kit, M09-S02, M07-S02, M05-S02, M18-S04 |
| TNA | TNA-0042 | M03-S02, M07-S02, M05-S02, Kit, M22, M18-S04 |
| Proposal | PRO-2026-0184 | M03-S02, Kit, M07-S02, M22 |
| Quotation | QUO-2026-0184 | Kit, M07-S02/S03, M13-S02, M22 |
| Approval | APV-2026-0771 | Kit, M18-S04, M22 |
| Engagement | ENG-0231 | M01, Kit, M02, M12, M10, M09, M07, M13, M22 (the pack's most cross-referenced record) |
| Invoice | INV-2026-0311, INV-2026-0288 | M01, M02, M09, M12, M13 (0311); M01, M03, M02, M13, Kit (0288) |
| Grant | GRT-2026-77412 | M12-S02 |
| Enquiry | ENQ-2026-0912 | M03-S02, Kit, M22 |
| Automation run | run #4821 (Proposal Agent, succeeded), run #4903 (Collections Agent, failed 3rd attempt) | Kit §05, M07-S02, M18-S01/S04 |
| Rule / circular ids | HRD-006, 007, 009, 011, 014, 015, 018, 020, 022, 023; Circular 2/2026, 02/2026, 04/2026, 09/2026 | M12-S02/S07/S08, Kit §10 |
| Named agents | Lead Agent, TNA Agent, Match Agent, Proposal Agent, Follow-up Agent, Collections Agent, Compliance Agent, Knowledge Agent | Across M03, M05, M07, M09, M12, M13, M16, M18 |

### 6.4 Amounts, dates and rates worth pinning in mocks

- WhatsApp BSP rates: **Utility RM 0.0564** / **Marketing RM 0.3467** per message (M03-S06, Kit §03).
- Commission 8% of sell, payable on collection; floor price = direct cost ÷ (1 − 0.35) (M07-S03) —
  flagged "rate card v0 · placeholder" per DECISIONS.md §5, real numbers pending Finance.
- Collections cadence: reminders at 7/30/45 days, human call at 60, trading hold at 75 with MD
  approval (M13-S05).
- HRDC claim window as originally drawn: 5 working days after completion (M12-S02) — **corrected** by
  DECISIONS.md §3 to 6 months from training completion; lead times 14 calendar days in-house, 3 days
  public until 31 Dec 2026 then 14 days from 1 Jan 2027.
- Demo date anchor: pack "built 11 Sep 2026"; most sample dates cluster Sep–Nov 2026 (e.g. 11 Sep 2026
  proposal approval timestamp, 14 Nov attendance lock, 07 Nov knowledge-source fetch failure).
- Peak model-pricing bands: 09:00–12:00 and 14:00–18:00 MYT (allowed-hours strip, DeepSeek pricing
  assumption, M20-S20).

---

## 7 · Design rules a component must enforce (from `CLAUDE.md` and `REPORT.md`)

From the project `CLAUDE.md` ("TrainOS — working principles"):
- **Consolidation over repetition**: any pattern repeated on more than two screens with the same
  behaviour must become a named kit component before reuse; if a screen needs something the kit lacks,
  add it to the kit first. Named patterns explicitly called out: RecordHeader, MetricStrip,
  LifecycleStepper, pill tab group, data table, filter bar, status/AI/autonomy chips, approval banner,
  proposed-action card, agent-run card, empty/loading/error states, drawers.
- When two variants of one pattern exist, the newer wins and the older migrates in the same pass —
  "divergence is a defect, not a style."
- One design system, one component library, one file per module.
- **Three colours only**: ink neutrals, electric blue `#1F5BFF`, charcoal `#181A1F`. Status colour
  lives on chips only. Blue budget 5–15% per screen.
- **AI is the primary hue** at 6% tint plus the ✦ glyph and a text label — never a solid fill and never
  a fourth accent colour. Solid blue always means a human triggered the action.
- **One solid primary button per view.**
- **Record identity appears once per page**: RecordHeader owns it, the breadcrumb owns the path —
  never duplicate either.
- Hierarchy comes from typography, alignment, spacing and separators before borders; if removing a
  border doesn't make a relationship ambiguous, remove it.
- Muted text `#69717C` or darker; non-text UI affordances at 3:1 contrast or better.
- **Stage names and order render from pipeline configuration, never hardcoded** (matches the
  LifecycleStepper's "Settings → M20-S07" note in Kit.dc.html §04).

From `REPORT.md` (build-level enforcement notes, useful as QA checks for the React build):
- Div balance verified at zero and no panel clipping at 1440×900 on every screen (a build-time
  sanity check worth replicating as a layout/overflow test).
- Exactly one solid primary button per screen, with two documented, deliberate exceptions:
  M07-S07 and M10-S06 (both locked states, primary omitted on purpose).
- Blue-area budget was measured per screen and kept inside 5–15% (excluding the 6% AI tint) — e.g.
  M02-S02 approval detail ~11%, M10-S06 locked state ~3%, M22 demo script ~2%.
- Money-moving action types (send, book, invoice, submit) can never be granted `Autonomous` — the
  autonomy ladder caps them at `Act w/ approval` regardless of jury result (also restated in
  DECISIONS.md §1/§2).
- Low-confidence AI content **warns**, it does not hard-block, and the flag must travel to the
  approver (M07-S02 pattern, generalised).
- Uncited AI prose is not permitted on record pages (source-citation chip rule, §3.6).
- A tier chip is deliberately neutral-coloured — a tier is a routing fact, not a status, and colouring
  it would spend accent budget on something the user can't act on.

Three corrections from `DECISIONS.md` that change on-screen numbers/labels versus what's currently
drawn (build teams should treat the *pattern* as authoritative but use these corrected values, not the
literal numbers baked into the current artboards):
- HRDC claim window is 6 months from completion, not 5 working days (M12-S02 banner + citation should
  read "Circular 2/2026", not the original assumption).
- Admin-hours-saved tile (M01-S01) should read "illustrative · baseline not yet measured," not imply a
  measured figure.
- Costing worksheet header (M07-S03) should read "rate card v0 · placeholder."

---

## 8 · What I could NOT verify / inconsistencies found

1. **Sidebar width discrepancy.** Kit.dc.html §01 "Geometry" states "sidebar 232" in prose, but every
   rendered sidebar (kit.js `K.sidebar`, the §07 Shell samples, and the §07 "Geometry proof" ruler
   diagram) is built at **240px** and the ruler diagram is explicitly labelled "Coordinates · sidebar
   width 240." Treat 240px as the authoritative build value; the 232 in the prose summary appears to
   be stale copy.

2. **M03-S06 "Follow-up queue" is undocumented in the narrative reports.** It has a complete
   `<details>` annotation panel in `M03 Leads.dc.html` (and a dark twin), and appears in the file
   alongside M03-S02, but it is **never mentioned** in `REPORT.md`'s two screen tables (the original
   19-screen list or the 6-screen update-pass list), nor in `DECISIONS.md` or `CLAUDE.md`. It is also
   **not referenced by `M22 Demo script.dc.html`**'s 19-step walkthrough. Its wiring notes ("Row →
   M04-S02 / M07-S02") are internally consistent with the rest of the pack, so it reads as a real,
   finished screen that simply fell out of the build report's bookkeeping — flag for the client/PM
   rather than silently including or excluding it.

3. **`M22 Demo script.dc.html` has no annotation panel at all.** Every other screen in the pack ends
   with a `<details>`/`<summary>` "Annotation & handoff" (or, for the 3 Kit proof screens, a shorter
   "Annotation" panel). M22-S04 has zero `<details>` elements — no Purpose/Primary user/Components/
   Data-contract/etc. fields to extract. Its content is a linear 19-step script (confirmed by grepping
   the screen ids it references: M01-S01, M02-S01, M02-S02, M03-S01, M03-S02, M04-S02, M05-S02,
   M06-S02, M07-S02, M07-S03, M07-S07, M09-S02, M10-S06, M12-S02, M13-S02, M13-S05, M18-S01, M18-S04,
   M22-S04), but nothing beyond that structural fact could be extracted for the "components used" /
   "data contract" columns.

4. **`M22 Demo script.dc.html` has no dark twin.** `Dark mode.dc.html`'s "Every screen in dark" grid
   (§1.2) lists a dark twin for Kit, M01, M02, M03, M05, M06, M07, M09, M10, M12, M13, M18 — thirteen
   entries — but does not include M22, M16 or M20 module groups, and no `Dark M22 Demo script.dc.html`
   / `Dark M16 Knowledge.dc.html` / `Dark M20 Settings AI.dc.html` module-level files exist as such
   (note: `Dark M16 Knowledge.dc.html` and `Dark M20 Settings AI.dc.html` **do** exist as files on disk
   even though they're absent from the §1.2 index grid in `Dark mode.dc.html` — that grid is simply
   stale/incomplete relative to the file listing. Only M22 genuinely has no dark counterpart anywhere).

5. **Screen-count reconciliation.** `REPORT.md`'s first table lists 19 screens; its "update pass"
   section adds 6 more (M20-S20, M20-S21, M20-S16, M12-S07, M12-S08, M16-S05) for a stated total of 25.
   Direct extraction from the `.dc.html` files finds **27 screen ids** with badges: those 25, plus
   M03-S06 (undocumented, see #2) and — depending on how you count — the fact that M02-S02, M03-S01
   and M04-S02 exist *only* as Kit.dc.html proof screens (i.e., "M02-S02" the kit-proof screen and any
   future "M02-S02" module screen are the same id referenced from two conceptual places: the kit's
   proof section and REPORT.md's screen table, which cites M02-S02 as "Kit (proof)" — so this is not a
   duplicate, just a screen that lives permanently in Kit.dc.html rather than a dedicated module file).
   Net: 26 distinct built screens + M22 the document = 27 ids, of which 26 have full annotations and
   one (M22) has none. Use the per-screen table in §4 as the authoritative list rather than either
   report total.

6. **No standalone module files for M04, M08, M02-S03, M18-S02, M18-S05, M20-S07.** These ids are
   referenced as wiring targets from other screens' "Wired to" fields (e.g. M06-S02 → M08-S02;
   M07-S03 → M02-S03; M18-S01 → M18-S02/M18-S05; the LifecycleStepper rule cites "Settings → M20-S07")
   but no corresponding `.dc.html` file or screen id exists anywhere in the pack. These are forward
   references to screens outside this design pack's scope, not broken links within it — flag for the
   API/build team rather than treating as an inventory gap.

7. **Kit.dc.html's three proof-screen annotations use a different field schema** than every module
   screen (`Purpose / Primary user / Key actions / AI behaviour / Click budget / Open questions` for
   M03-S01, similar-but-not-identical for M02-S02 and M04-S02) versus the module screens' 9-field
   schema (`Purpose / Primary user / Components used / Data contract / Actions & policy gates / States
   rendered / AI & approval behaviour / Wired to / Assumptions`). Neither "Data contract" nor
   "Components used" is present on the proof screens in machine-extractable form, so those three rows
   in §4 are necessarily thinner than the rest of the table — this is a source-format limitation, not
   an extraction miss.

8. **Danger-red hex has two spellings in the source** (`#B4403B` and `#B9413D`) used interchangeably
   for the same semantic danger colour across different sections of `Kit.dc.html` (e.g. Foundations
   swatch uses `#B4403B`, several chip/button samples in §02–03 use `#B9413D`). Both are documented in
   §1.1; treat them as the same token with an authoring inconsistency rather than two intentional
   shades — pick one (recommend `#B4403B`, since it's the value used in `Dark mode.dc.html`'s formal
   token table) for the production token.

9. **`support.js` and `build/kit.js`'s runtime plumbing were not treated as design source.**
   `support.js` (1911 lines) is a generated bundle labelled "GENERATED from dc-runtime/src/*.ts — do
   not edit," implementing the artboard viewer/parser (React-based `<x-dc>` custom element parsing) —
   it contains no design tokens or fixture data and was confirmed out of scope by inspection, not
   skipped.

10. **Screenshots and uploads directories were not inventoried.** The source folder contains
    `screenshots/` (20 entries) and `uploads/` (24 entries) sibling directories that were not opened,
    per the task's focus on the `.dc.html`/`kit.js` design source; if these contain reference imagery
    or brand assets relevant to the React build, a follow-up pass should open them explicitly.
