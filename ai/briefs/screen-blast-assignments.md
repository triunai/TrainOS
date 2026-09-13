# Screen blast — 12 Opus agents, one per module group

Common brief (prepended to each):

- Repo /Users/khumeren/Repos/personal-work/trainos, branch main, SHARED worktree. Write ONLY under apps/web/src/features/<feature>/ and apps/web/src/routes/<feature>.routes.tsx. Commit ONLY `git commit -- apps/web/src/features/<feature> apps/web/src/routes/<feature>.routes.tsx -m "feat(screens): <ids>"` with trailers.
- Sources: docs/research/09-design-pack-inventory.md §4 rows for your screen ids (primary user, single primary button, states rendered, components used, data-contract line, wiring), §5 layout template, §7 rules; docs/design/<file>.dc.html for pixel anatomy (grep the screen id, extract the artboard div by sed; do not read 300KB linearly); dark twin file for verification.
- Build ONLY from @/shared/components/kit (export list below) + @/shared/components/ui + @/shared/components/states + @/shared/components/layout. If a component is missing, message the agent named `kit` with the exact prop shape you need and use a placeholder import that kit will fill; NEVER build a local variant.
- Data ONLY via `useApi()` → FixtureClient methods (list below) wrapped in react-query hooks in features/<feature>/api.ts. Every primary button calls client.performAction or the section method and renders the response variant (EXECUTED / QUEUED_FOR_APPROVAL banner / SUGGESTED draft), errors via ContractError code → kit ErrorState/ExceptionBanner. Missing fixture or method → message the agent named `fixtures`.
- Rules: one solid primary per view (use useSinglePrimary), status colour only via StatusChip, AI = AIChip/tint never solid, RecordHeader owns identity once, breadcrumb owns the path, muted ≥ #69717C, stages from server LifecycleStep[], no hardcoded hex, dark mode via tokens only.
- Each screen: route registered in your routes file (paths from nav TREE), loading/empty/error states, a vitest render test with the fixture client asserting the primary action and each "state rendered" from 09 §4 is visible, and screenshots light+dark at 1440×900 via Playwright MCP into features/<feature>/**screenshots**/ compared by eye against the .dc.html twin — list every visible deviation in your report.
- Phase 1: list screens, components you'll use, fixture methods you'll call. Phase 3: deviations + "What I could NOT verify".

Assignments (feature folder → screen ids → source files):

1. dashboard → M01-S01 executive dashboard, M22-S04 demo index (as /dev/demo linking every screen) → M01 Dashboards.dc.html, M22 Demo script.dc.html
2. enquiries → M03-S01 enquiry inbox (Kit.dc.html proof), M03-S02 enquiry detail, M03-S06 follow-up queue → M03 Leads.dc.html, Kit.dc.html
3. organisations → M04-S02 organisation 360 (Kit.dc.html proof); tna → M05-S02 TNA detail → M05 TNA.dc.html
4. programmes → M06-S02 programme detail + programmes list → M06 Programmes.dc.html
5. proposals → M07-S02 proposal builder, M07-S03 costing worksheet → M07 Proposals.dc.html
6. portal → M07-S07 client proposal page (ExternalMinimalShell, public route /p/:token) → M07 Proposals.dc.html
7. approvals → M02-S01 approval inbox, M02-S02 approval detail (Kit.dc.html proof) → M02 Approvals.dc.html, Kit.dc.html
8. engagements → M09-S02 engagement detail, M10-S06 attendance capture → M09 Operations.dc.html, M10 Participants.dc.html
9. hrdc → M12-S02 claim packet, M12-S07 rules registry, M12-S08 rule change review → M12 HRD Corp.dc.html
10. finance → M13-S02 invoice detail, M13-S05 collections queue → M13 Finance.dc.html
11. agents → M18-S01 agent registry, M18-S04 run trace #4821 (consume @trainos/agent-runtime run shape; a "Run now" button may call runAgent with MockProvider) → M18 Agents.dc.html
12. settings-ai + knowledge → M20-S20 tiers/routing, M20-S21 provider keys BYOK, M20-S16 usage/budgets, M16-S05 knowledge sources → M20 Settings AI.dc.html, M16 Knowledge.dc.html

After all 12: verifier agent — every route renders in both themes, screenshot diff vs Dark files, blue-budget estimate per screen, one-primary check, a11y pass, typecheck/lint/test/build/arch:graph green.
