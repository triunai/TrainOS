# Design pack — provenance

Everything else in this directory is a **verbatim copy** of the design pack, not
a derivative. Do not edit these files to record a decision: they are the record
of what was drawn, and a change here silently rewrites the reference every
screen is checked against.

Copied on 2026-09-12 from `~/Downloads/Waiting on scope answers (1)/`.

| What | Files |
|---|---|
| Artboards, light | `M*.dc.html`, `Kit.dc.html` |
| Artboards, dark | `Dark *.dc.html` — a 1:1 twin per light screen |
| The kit's own source | `build/kit.js` — the TREE, the ROLE map, the `K.C` colour table |
| Shared runtime | `support.js` |
| Screenshots | `screenshots/` |
| Written record | `REPORT.md`, `DECISIONS.md`, `CLAUDE.md`, `API.md`, `API_CONTRACT.md`, `API_CONTRACT_PROMPT.md` |

Not copied: `uploads/`, and the agent-state directories.

## Reading order

1. `docs/research/09-design-pack-inventory.md` — the extraction. Tokens in §1,
   the nav tree in §2, the kit catalogue in §3, screens in §4, layout in §5,
   fixtures in §6, the rules a component must enforce in §7, and **§8, what
   could not be verified**, which is the section to read before trusting a
   number.
2. `DECISIONS.md` — three corrections that change on-screen values versus what
   the artboards currently draw. Treat the pattern as authoritative and the
   corrected values as the real ones.
3. The `.dc.html` for the screen you are building, plus its dark twin.

## Where the pack's values actually live now

| Pack artefact | Lives in the app as |
|---|---|
| `K.C` colour table and the dark map | `apps/web/src/styles/tokens.css` |
| `TREE` and `ROLE` | `apps/web/src/shared/config/navTree.ts`, transcribed verbatim |
| Shell dimensions | `apps/web/src/shared/config/chrome.ts` and the `--shell-*` tokens |

If the pack and the app disagree, the pack is the source for **what it draws**
and the app is the source for **what ships**. Reconcile in the open: write the
decision into `ai/state.md`, do not edit the pack.
