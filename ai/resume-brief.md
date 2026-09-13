# Resume brief — 13 Sep 2026 11:50 (+08)

Read this first in the new session, then `ai/hot-state.md`, then `docs/design/2026-09-13-design-tightening-brief.md`.

## State at wrap

- HEAD green as of bc5efbc (typecheck/lint/415 web tests/build/arch) plus later commits from shell-fix (6348676 …), dash-fix (241123f), applier-2 (f45d99f …). Re-run root gates first; fix before launching anything.
- Dev server: `npm run dev -- --port 5180` (8080 is taken). Demo index `/dev/demo`, kit `/dev/kit`.
- Shared worktree rules (CLAUDE.md R9, R12–R14): pathspec commits only; never --amend/reset/rebase; `git show --stat --format="" HEAD` after every commit; check the file not the message; receiving side rejects unknown values.
- Supabase: PAUSED at 010 (supabase/HANDOFF.md). Resume 011–016 with **Codex gpt-5.6 xhigh** via the codex plugin (installed, logged in), one batch per round, Claude reviews vs docs/architecture/06-critic-review.md.

## Agents that were running at wrap (relaunch any whose last item is not committed)

1. **shell-fix** (Opus) — layout/, index.css, tokens.css. Queue in order: hide scrollbars site-wide until scrolling (§14); sidebar accordion collapse + eased leak-free animation; selected child reflects route + parent auto-open + two hierarchy mechanisms; seamless sidebar/topbar surface; only active group expanded; footer = Help & support · Shortcuts · Role drop-up (DEV) · version line (no « chevron); profile row at TOP under wordmark + light/dark toggle switch; kit **ProfileModal** from Kit.dc.html "PROFILE MODAL · 960"; topbar = breadcrumb · search ⌘K · bell with badge count · EN | BM switch + I18nProvider with shell strings in EN/BM (§12, §12a, §12b, §17).
2. **applier-2** (Opus) — features/**, shared/api, kit additive. Queue: review findings docs/reviews/2026-09-13-web-best-practices-review.md steps 2–7 (stable idempotency keys via useAction; 14 ErrorState sites pass the error object; useSinglePrimary by instance; promote TextField/DateField/TextArea/RefusalBanner/statusTone maps/renderScreen to kit; consolidate errorCodeOf/errorMessageOf; remaining HIGH); the three screens missing the 20px page gutter + inline Breadcrumb (programmes list, costing worksheet, proposal builder); inline LifecycleStepper in every table row the artboards draw it (§11a). Append "Applied" table to the review doc.
3. **proto-header** (Opus) — features/approvals/ApprovalDetail.tsx + kit RecordHeader/MetricStrip additive variants: collapsible header, soft-gradient metric card (`--surface-accent-gradient`), metrics spread evenly, card expands into the detail sections (§15). Prototype only on the approval detail; report blue-area % and a propagate recommendation.

## Next blast (launch after the three above are committed and gates are green)

A. **kit-tighten** (Opus): brief §1–§9 + §10/10a (segmented control) at kit/token level: `--font-ui/--font-code`, tabular numerals, radius scale (6/10/999), surface layers L0–L3, mono down 70–80%, flatten ContentCard → page-as-component, DataTable typography + zebra where artboards draw it, FilterBar unboxed, section caption component. Verify on /dev/kit, Programmes, Collections both themes.
B. **screens-migrate** (2–3 Opus, split by feature groups as in the ai/briefs/screen-blast-assignments.md): move all 27 screens to page-as-component, apply §16 (enquiry rows/detail; money/date as data, provenance only on exceptions), §11 per-screen fidelity checklist from each artboard annotation, propagate the RecordHeader upgrade if the prototype is approved.
C. **fixtures-persona** (Sonnet): MD `/me` = Alex Selvarajah (§13); demo index narrated to him; ProfileModal fields.
D. **verifier** (Opus): every route, light + dark, 1440×900 + 1920×1080, screenshot vs artboard twin, per-screen checklist, blue budget, one primary, a11y, no scrollbars at rest, root gates; findings file + fix list.
E. **i18n pass** (§17) and **Supabase 011–016 via Codex** in parallel with D.

## What to eyeball fast (after shell-fix lands)

1. `/approvals/APV-2026-0771` — the prototype header: collapse the header, collapse/expand the gradient metric card, both themes. Decide: propagate as-is / softer / drop.
2. Sidebar: profile at top + theme switch; accordion open/close; selected child; no scrollbar at rest; footer items; EN | BM switch flips shell strings.
3. `/dashboard` — rebuilt against M01 (paired bars, 38px rows).
4. `/sales/enquiries` — split header rows aligned; row typography (will change again in blast B).
5. `/sales/organisations/ORG-0114` — engagements table now with inline lifecycle steppers (after applier-2).
