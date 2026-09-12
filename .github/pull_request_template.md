# Pull Request

## Summary
<!-- 1-3 bullets: what changed and why -->
-

## Changes
<!-- High-level groupings — frontend / schema / docs / scripts -->
-

## Test plan
<!-- How was this verified? Commands run, paths exercised, screenshots if UI -->
- [ ] `npm run verify:deploy` clean
- [ ] Manual smoke on the affected routes
- [ ] (if schema) migration + rollback + SQL test + catalog entry in THIS commit; `npm run lint:sql` and `npm run check:grants` clean
- [ ] (if new UI) empty / loading / error states present; light and dark both checked
- [ ] (if new UI) one solid primary button in the view; blue budget still 5-15%

## Schema / architecture impact
<!-- If this touches supabase/, link the migration and its catalog entry. Otherwise: N/A -->
-

## Other checks
- [ ] No new `as unknown as` double cast without a runtime guard
- [ ] No raw colour literal in a component — every colour comes from a token
- [ ] Any new fire-and-forget mutation carries `meta: { toastOnError: true }`
- [ ] No `console.log` left in production paths (the build strips it, but review it anyway)
