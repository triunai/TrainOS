# Postmortems

One file per incident, `YYYY-MM-DD-{short-slug}.md`, **dated by the day
identified, not the day resolved**. Never deleted, occasionally referenced.

Separation from the backlog: backlog = we should do this when convenient.
Postmortem = this is what we learned.

Section order: header block (`Date identified`, `Severity`, `Status`) →
`## Summary` → `## Impact` → `## Timeline` (a `When | What` table) →
`## Root Cause` (numbered contributing factors) →
`## Why <the safety net> did not catch it` → `## What went well` /
`## What went wrong` → `## Mitigation` → `## Durable Rule` → `## References`.

`## Why the safety net did not catch it` is the section that earns the file. The
incident is usually less interesting than the gate that should have caught it
and did not.

| Date | Incident | Severity | Durable rule produced |
|---|---|---|---|
