# Stack and configuration — showroom (Wishes2Vows) vs vern-vault

Source repos:
- `showroom` = `/Users/khumeren/Repos/personal-work/showroom` (Wishes2Vows, mature reference)
- `vern-vault` = `/Users/khumeren/Repos/personal-work/vern-vault` (lighter, "Vern Motors" car broker app)

All citations are `file:line` into the source repos as of the read on 2026-09-12. Node modules and
`dist` were not read. CI, lefthook, guardrails scripts, Supabase schema/RLS, and docs conventions
are explicitly out of scope for this file (owned by other research files).

## 1. package.json — dependencies

Both repos are `vite_react_shadcn_ts` scaffolds (`"name": "vite_react_shadcn_ts"` in
`showroom/package.json:2` and `vern-vault/package.json:2` — vern-vault never renamed the
Lovable-generated package name even though the app is "Vern Motors" / internal name "revura", see
`vern-vault/render.yaml:3`).

### Core dependencies present in both (same or close versions)

| Package | showroom | vern-vault |
|---|---|---|
| react / react-dom | `^18.3.1` (`showroom/package.json:116-119`) | `^18.3.1` (`vern-vault/package.json:61,63`) |
| react-router-dom | `^6.30.1` (`showroom/package.json:123`) | `^6.30.1` (`vern-vault/package.json:68`) |
| @tanstack/react-query | `^5.83.0` (`showroom/package.json:95`) | `^5.83.0` (`vern-vault/package.json:48`) |
| @supabase/supabase-js | `^2.90.1` (`showroom/package.json:94`) | `^2.106.1` (`vern-vault/package.json:47`, newer) |
| zod | `^3.25.76` (`showroom/package.json:131`) | `^3.25.76` (`vern-vault/package.json:74`) |
| react-hook-form + @hookform/resolvers | same versions (`showroom/package.json:66,121`; `vern-vault/package.json:18,64`) | |
| Radix UI primitives (~28 packages) | full shadcn/ui set, `showroom/package.json:67-93` | same full set, `vern-vault/package.json:20-46` |
| class-variance-authority, clsx, tailwind-merge, tailwindcss-animate | identical versions | identical versions |
| cmdk, vaul, sonner, embla-carousel-react, recharts, react-day-picker, react-resizable-panels, next-themes, date-fns, input-otp | identical versions in both (`showroom/package.json:99-129`; `vern-vault/package.json:51-73`) | |
| lucide-react | `^0.462.0` both | |
| Dev tooling core: `@types/node`, `@types/react(-dom)`, `@vitejs/plugin-react-swc`, `typescript`, `typescript-eslint`, `eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `jsdom`, `autoprefixer`, `postcss`, `tailwindcss`, `vite`, `vitest` | same versions, `showroom/package.json:134-171` | same versions, `vern-vault/package.json:76-100` |

Conclusion: the two repos share one **core stack skeleton** — React 18 + Vite 5 (`@vitejs/plugin-react-swc`) + React Router 6 + TanStack Query 5 + Supabase JS 2 + Zod 3 + React Hook Form 7 + shadcn/ui (Radix + CVA + tailwind-merge) + Tailwind 3 + Vitest 2 + ESLint 9 flat config + TypeScript 5.8. This skeleton is the right thing for trainos to copy verbatim.

### showroom-only dependencies — flag OPTIONAL (wedding/visual-effects specific) vs CORE

Dependencies in `showroom/package.json:61-171` not present in vern-vault:

**OPTIONAL — wedding/visual-effects specific, do NOT default-copy into trainos:**
- `@dnd-kit/core` `@dnd-kit/modifiers` `@dnd-kit/sortable` (`showroom/package.json:62-64`) — seating-planner drag & drop (`src/features/seating/*`)
- `gsap` + `@gsap/react` (`showroom/package.json:65,107`) — animation; vern-vault also has `gsap`/`@gsap/react` (`vern-vault/package.json:17,56`) but showroom's version is newer (`^3.14.2` vs `^3.15.0` — note vern-vault is actually *ahead* here, `vern-vault/package.json:56`)
- `d3-selection`, `d3-transition`, `d3-zoom` + `@types/d3-*` (`showroom/package.json:100-102,141-143`) — seating-planner canvas pan/zoom
- `framer-motion` (`showroom/package.json:106`) — vern-vault uses `motion` instead (`vern-vault/package.json:59`), the renamed/successor package; these are alternatives, not both-needed
- `html-to-image`, `react-to-print`, `exceljs`, `papaparse` (`showroom/package.json:108,105,115,124`) — export/print features (seating charts, guest list Excel/CSV export)
- `lenis` (`showroom/package.json:110`) — smooth-scroll library for marketing/landing pages
- `libphonenumber-js` (`showroom/package.json:111`) — phone validation, wedding RSVP forms
- `ogl` (`showroom/package.json:114`) — lightweight WebGL, used for landing-page visual effects
- `swiper` (`showroom/package.json:127`) — carousel, template galleries
- `react-colorful` (`showroom/package.json:117`) — color picker, Studio theme editor
- `zustand` (`showroom/package.json:132`) — state stores (seating planner, editor); vern-vault has no client state library dependency at all
- `@use-gesture/react` (`showroom/package.json:96`) — touch/drag gestures
- `sharp` (dev, `showroom/package.json:164`) — image optimization script (`scripts/optimize-assets.mjs`)
- `libpg-query` (dev, `showroom/package.json:159`) — SQL parsing for `tools/sql-lint.mjs`, tied to the Supabase migration tooling (out of scope here)
- `dependency-cruiser` (dev, `showroom/package.json:151`) — architecture graph enforcement (`.dependency-cruiser.cjs`, `npm run arch:graph`)
- `fallow` (dev, `showroom/package.json:155`) — dead-code/dupes auditing CLI
- `lefthook` (dev, `showroom/package.json:158`) — git hooks (explicitly out of scope per task, noted only for completeness)
- `@commitlint/cli` + `@commitlint/config-conventional` (dev, `showroom/package.json:135-136`) — commit message linting
- `vite-bundle-visualizer` (dev, `showroom/package.json:169`) — bundle analysis
- `prettier` + `lint-staged` (dev, `showroom/package.json:160,163`) — vern-vault has neither; there is no formatting step at all in vern-vault's `package.json` scripts
- `@vitest/coverage-v8` (dev, `showroom/package.json:149`) — coverage reporting, wired into `vitest.config.ts` (`showroom/vitest.config.ts:35-51`)

**Confirmed model/CAD-viewer type dependency the task flagged does NOT appear in showroom** — `@google/model-viewer`, `cobe`, and `effect` are **vern-vault-only** additions (see next section), not showroom dependencies. There is no `model-viewer` reference anywhere in `showroom/package.json`.

### vern-vault-only dependencies — flag OPTIONAL (car-marketplace specific)

Dependencies in `vern-vault/package.json:15-100` not present in showroom:

**OPTIONAL — domain-specific to the car-broker app, not relevant to trainos:**
- `@google/model-viewer` (`vern-vault/package.json:16`) — 3D `<model-viewer>` web component for vehicle inventory pages
- `cobe` (`vern-vault/package.json:52`) — WebGL rotating-globe visualization
- `@niklaserik/effect-mcp` + `effect` (`vern-vault/package.json:19,54`) — the Effect-TS functional runtime library; an unusual, heavyweight dependency for what is otherwise a plain React/Zod app — worth flagging as an outlier that trainos should NOT inherit unless a specific reason exists
- `react-imask` (`vern-vault/package.json:66`) — input masking (phone/currency fields)
- `react-icons` (`vern-vault/package.json:65`) — icon kit in addition to `lucide-react`
- `motion` (`vern-vault/package.json:59`) — animation (successor package to `framer-motion`, see above)
- `@tailwindcss/typography` (dev, `vern-vault/package.json:78`) — prose/typography plugin, not present in showroom
- `@testing-library/dom` (dev, `vern-vault/package.json:79`) — explicit dep; showroom relies on the transitive copy via `@testing-library/react`

### Recommendation for trainos dependency baseline

Copy the **core stack table** above verbatim. Treat every item in "OPTIONAL" as pull-in-when-needed, not default scaffolding. Of the showroom-only dev tooling, `dependency-cruiser`, `fallow`, and `prettier`/`lint-staged` are good general-purpose hygiene tools worth adopting even though they're "showroom-only" — they aren't wedding-specific, they're just missing from the lighter vern-vault scaffold.

## 2. package.json — scripts

### showroom (`showroom/package.json:7-52`)

| Script | Does |
|---|---|
| `dev` | `vite` — start dev server |
| `dev:fresh` | `node scripts/dev-fresh.mjs` — presumably a clean-cache dev start (script content not read; out of scope) |
| `build` | `vite build && node scripts/generate-demos.js` — production build, then generates demo/OG assets |
| `build:dev` | `vite build --mode development` — dev-mode build (keeps console/debugger, sourcemaps) |
| `lint` | `eslint .` — full-repo ESLint |
| `lint:hooks` | `eslint src --config eslint.hooks.config.js` — narrow rules-of-hooks-only pass over `src` |
| `preview` | `vite preview` — preview a production build locally |
| `check:rpc` | `node scripts/rpc-contract-check.js` — validates Supabase RPC contracts (out of scope) |
| `check:grants` | `node scripts/check-grants.mjs` — DB grants check (out of scope) |
| `check:applied` / `check:applied:record` | `node scripts/check-applied.mjs [--record]` — migration-applied check (out of scope) |
| `check:edge` / `check:edge:record` | `node scripts/check-edge-deploy.mjs [--record]` — edge function deploy check (out of scope) |
| `lint:sql` | `node tools/sql-lint.mjs` — SQL linting (out of scope) |
| `typecheck` | `tsc -p tsconfig.app.json --noEmit` — main app type-check |
| `typecheck:strict` | `tsc -p tsconfig.strict.json --noEmit` — strict-ratchet type-check (see §3) |
| `verify:deploy` | `npm run typecheck && npm run lint:hooks && npm run typecheck:strict && npm run test` — pre-deploy gate, also used as the Render `buildCommand` (`showroom/render.yaml:5`) |
| `format` / `format:check` | `prettier --write .` / `prettier --check .` |
| `sast` | `semgrep scan --config .semgrep/rules.yml` — static security analysis |
| `test` / `test:watch` / `test:coverage` | `vitest run` / `vitest` / `vitest run --coverage` |
| `guardrails:on/off/status`, `guard` | `node scripts/guard.mjs …` — guardrails tooling (out of scope) |
| `arch:graph` / `arch:baseline` | dependency-cruiser architecture validation / baseline capture |
| `compositor:check` / `compositor:baseline` | `node scripts/compositor-budget-check.mjs [--baseline]` — a perf/compositor budget ratchet |
| `bundle:check` / `bundle:baseline` | `node scripts/bundle-budget-check.mjs [--baseline]` — bundle-size budget ratchet |
| `bundle:analyze` | `vite-bundle-visualizer` — visualize bundle composition |
| `loadtest:smoke` / `loadtest:probe` / `loadtest:slo` | `k6 run loadtests/tests/*.js` — k6 load tests |
| `loadtest:verify` | `node loadtests/verify.mjs` — load test result verification |
| `fallow:audit` / `fallow:health` / `fallow:dead` / `fallow:dupes` | `fallow …` — dead-code/duplication audits |
| `prepare` | `lefthook install` — git hooks install (out of scope) |
| `assets:optimize` | `node scripts/optimize-assets.mjs` — image optimization via `sharp` |

### vern-vault (`vern-vault/package.json:6-14`) — the entire script set

| Script | Does |
|---|---|
| `dev` | `vite` |
| `build` | `vite build` — no post-build demo/asset generation step |
| `build:dev` | `vite build --mode development` |
| `lint` | `eslint .` |
| `preview` | `vite preview` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |

vern-vault has **no** `typecheck` script at all (relies on IDE/build-time TS checking only), no `format`/`prettier`, no coverage script, no budget/architecture/loadtest tooling, and no `prepare` hook.

### Recommendation for trainos

Adopt vern-vault's minimal 7-script set as the floor, then add from showroom's set as the project matures: `typecheck` (cheap, high value — add immediately), `format`/`format:check` (prettier), `test:coverage`, and `lint:hooks` + `typecheck:strict` only once the strict-ratchet pattern (§3) is adopted. Skip the Supabase migration checks, k6 load tests, `fallow`, `dependency-cruiser`, and `compositor`/`bundle` budget scripts until there's a concrete need — they're mature-project ratchets, not day-one scaffolding.

## 3. vite.config.ts

### showroom (`showroom/vite.config.ts`, 98 lines) — full detail

- **Plugins** (`:2,4,12`): `@vitejs/plugin-react-swc` always; `lovable-tagger`'s `componentTagger()` only when `mode === "development"`, filtered via `.filter(Boolean)`.
- **Server** (`:8-11`): `host: "::"` (all interfaces, IPv6-capable), `port: 8080`.
- **Alias** (`:13-17`): `"@"` → `path.resolve(__dirname, "./src")`.
- **esbuild console/debugger stripping** (`:20-22`): `drop: mode === "production" ? ["console", "debugger"] : []` — production builds strip all `console.*` and `debugger` statements; dev keeps them. Comment cites `task-033b §S-06`.
- **Build options** (`:23-72`):
  - `minify: "esbuild"` (`:25`) — explicit, default esbuild minifier.
  - `rollupOptions.output.manualChunks` (`:27-64`) — a function-form manual-chunk splitter:
    - `wedding-config` chunk (`:34-39`) for `src/shared/config/wedding.config.*` and `src/shared/config/index.ts` — kept as one named lazy chunk deliberately, per an inline comment, to keep the bundle-budget ratchet legible.
    - `react-vendor` (`:41-47`) for react/react-dom/react-router.
    - `animation` (`:49`) for `framer-motion`.
    - `date-utils` (`:51`) for `date-fns`.
    - `gsap-vendor` (`:53`), `ogl-vendor` (`:54`) — 3D/WebGL vendor splits.
    - `swiper-vendor` (`:56`), `lenis-vendor` (`:57`) — UI/scroll vendor splits.
    - `d3-vendor` (`:59-60`) for `d3-selection`/`d3-zoom`.
    - `dnd-vendor` (`:62`) for `@dnd-kit/*`.
  - `target: "es2020"` (`:67`).
  - `sourcemap: mode === "development"` (`:69`) — no sourcemaps shipped to production.
  - `chunkSizeWarningLimit: 500` (`:71`).
- **optimizeDeps.include** (`:80-96`): an explicit pre-bundle allowlist — react, react-dom, react-router-dom, framer-motion, gsap, @gsap/react, ogl, lenis, swiper, date-fns, lucide-react, zustand, @tanstack/react-query, @supabase/supabase-js. Inline comment (`:74-79`) explains why: any heavy dependency a lazy route/splash pulls in must be pre-bundled here, or Vite discovers it mid-session, re-optimizes, and hard-reloads — observed as "first load fine, next reload hangs white for 5–8s." Dev-only concern; production build never re-optimizes.

### vern-vault (`vern-vault/vite.config.ts`, 19 lines) — full detail

- **Plugins** (`:12`): identical pattern — `react()` always, `componentTagger()` in dev mode only.
- **`base: '/'`** (`:8`) — explicit base path; showroom does not set this (defaults to `/` anyway, so functionally equivalent but stated explicitly in vern-vault).
- **Server** (`:9-11`): identical `host: "::"`, `port: 8080`.
- **Alias** (`:14-17`): identical `"@"` → `./src`.
- **No** esbuild drop config, no custom `build` block (no manualChunks, no target/sourcemap/chunkSizeWarningLimit overrides), no `optimizeDeps.include`.

### Recommendation for trainos

Start from vern-vault's minimal config (react-swc plugin + dev-only tagger + `@` alias + fixed dev port). Add showroom's production-only console/debugger stripping immediately — it's cheap and generically useful, not wedding-specific. Defer the `manualChunks` vendor-splitting and `optimizeDeps.include` allowlist until trainos actually has heavy lazy-loaded dependencies causing the dev-reload thrash showroom describes; premature chunk-splitting rules tied to specific package names (`wedding-config`, `gsap-vendor`) would need re-authoring anyway.

## 4. TypeScript configs

### tsconfig.json (project references root) — identical in both repos

`showroom/tsconfig.json:1-16` and `vern-vault/tsconfig.json:1-16` are byte-for-byte identical: `references` to `tsconfig.app.json` and `tsconfig.node.json`; root `compilerOptions` sets `baseUrl: "."`, `paths: {"@/*": ["./src/*"]}`, and loosens `noImplicitAny`, `noUnusedParameters`, `noUnusedLocals`, `strictNullChecks` all to `false`, with `skipLibCheck: true` and `allowJs: true`.

### tsconfig.app.json — identical in both repos

`showroom/tsconfig.app.json:1-29` and `vern-vault/tsconfig.app.json:1-29` are identical: ES2020 target, `useDefineForClassFields: true`, DOM libs, bundler module resolution, `jsx: "react-jsx"`, `strict: false` with the same four linting flags disabled, same `@/*` path alias, `include: ["src"]`.

### tsconfig.node.json — identical in both repos

`showroom/tsconfig.node.json:1-22` and `vern-vault/tsconfig.node.json:1-22` are identical: ES2022 target, ES2023 lib, `strict: true` (this file — which only type-checks `vite.config.ts` — is strict in both repos even though the app config is not).

### tsconfig.strict.json — showroom ONLY, vern-vault has no equivalent file

`showroom/tsconfig.strict.json:1-141` exists; `vern-vault/tsconfig.strict.json` does not exist (confirmed: `ls` returns "No such file or directory").

This is the **"graduated allowlist ratchet"** pattern, explained in the file's own header comment (`showroom/tsconfig.strict.json:2-20`):
- The base `tsconfig.app.json` has `strictNullChecks: false` because flipping strict mode on globally would surface 100+ legacy issues at once (`:4-5`).
- `tsconfig.strict.json` `extends: "./tsconfig.app.json"` (`:21`) and turns on the full strict family: `strict`, `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict` (`:22-30`), while explicitly keeping `noUncheckedIndexedAccess: false` and the unused-vars/params rules off (`:31-33`) — a narrower graduation than TS's full strict surface.
- Its `include` array (`:36-139`) **replaces** the base config's `["src"]` and is a hand-curated, one-file-at-a-time allowlist ("graduates"): each file was individually audited to pass strict mode, then permanently pinned here so a regression elsewhere can't loosen it (`:11-16`).
- `src/vite-env.d.ts` is always included (`:42`) purely for ambient `ImportMetaEnv` declarations, not as a "graduate."
- The workflow is documented inline (`:10-16`): pick a file → temporarily add it to `include` → run `npx tsc -p tsconfig.strict.json --noEmit` → fix strict errors → commit the file's path permanently.
- The rationale comment (`:18-20`) explicitly compares this to .NET's per-project `<Nullable>enable</Nullable>` rollout pattern: local audit beats a big-bang flip.
- As of the current showroom state, ~50 files have graduated (`:47-139`), each annotated with why it graduated (e.g. "the auth client itself... decides how every human being obtains a session," `:134-138`).
- `npm run typecheck:strict` (`showroom/package.json:23`) runs `tsc -p tsconfig.strict.json --noEmit`, and it's part of the `verify:deploy` gate (`showroom/package.json:24`).

**Why strict is separate rather than just turning `strict: true` on in `tsconfig.app.json`:** doing so would fail the build on every one of the hundred-plus pre-existing null-safety gaps in the untouched majority of the codebase. The separate config lets CI enforce strict-mode correctness on a growing, explicit subset of files without blocking on the rest — a ratchet that only tightens.

### Recommendation for trainos

Copy `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` verbatim (they're identical between showroom and vern-vault, so they're the safe baseline). Adopt the `tsconfig.strict.json` ratchet pattern from day one — it costs nothing when the `include` list starts empty (just `vite-env.d.ts`) and is far easier to grow gradually than to retrofit once the codebase is large. Do not attempt to just set `strict: true` globally.

## 5. Tailwind and PostCSS

### postcss.config.js — identical in both repos

`showroom/postcss.config.js:1-6` and `vern-vault/postcss.config.js:1-6` are identical: `{ tailwindcss: {}, autoprefixer: {} }`.

### tailwind.config.ts — same skeleton, showroom extends it much further

Both (`showroom/tailwind.config.ts`, `vern-vault/tailwind.config.ts`) share:
- `darkMode: ["class"]`
- `content` globs covering `pages/`, `components/`, `app/`, `src/`
- `prefix: ""`
- a `container` block (centered, padded)
- the same **CSS-variable-driven color token pattern**: every semantic Tailwind color (`border`, `input`, `ring`, `background`, `foreground`, `primary`, `secondary`, `destructive`, `muted`, `accent`, `popover`, `card`, `sidebar`) is defined as `hsl(var(--token-name))`, meaning the actual color values live in CSS custom properties (in `src/index.css`) and Tailwind just wires up the color-utility names to those variables. This is the shadcn/ui default pattern in both repos.
- the same `borderRadius` (`lg/md/sm` derived from `var(--radius)`), the same `accordion-down`/`accordion-up` keyframes/animations, and the same `plugins: [require("tailwindcss-animate")]`.

Differences:
- **Container padding/breakpoints**: showroom uses `padding: "1rem"` with explicit `sm/md/lg/xl` screen breakpoints (`showroom/tailwind.config.ts:15-21`); vern-vault uses `padding: "2rem"` with only a `2xl: "1400px"` breakpoint (`vern-vault/tailwind.config.ts:10-13`) — this is the stock shadcn/ui scaffold default, unmodified.
- **fontFamily**: vern-vault hardcodes literal font stacks — `sans: ['Inter', 'system-ui', 'sans-serif']`, `serif: ['Playfair Display', 'Georgia', 'serif']` (`vern-vault/tailwind.config.ts:15-18`). showroom instead routes fonts through CSS variables with fallback stacks — `serif: ['var(--font-serif, "Cormorant Garamond", Georgia, serif)']`, `sans: ['var(--font-sans, "DM Sans", system-ui, sans-serif)']` (`showroom/tailwind.config.ts:34-37`) — an indirection layer with a detailed inline comment (`:24-33`) explaining it exists so a **per-wedding runtime-configurable font** can override `--font-serif`/`--font-sans` at the wedding-theme surface (`buildWeddingThemeStyles`) while every other surface (Ops, Studio, landing) keeps the fallback values, which are byte-identical to the pre-indirection literals.
- **Extra color tokens, showroom only**: a `wedding` color group (`cream`, `gold`, `gold-light`, `rose`, `rose-muted`, `charcoal`, `overlay`, all `hsl(var(--wedding-*))`, `showroom/tailwind.config.ts:72-80`) and a `brand` semantic group using `rgb(var(--brand-*) / <alpha-value>)` syntax for alpha-composable theme-aware tokens that switch gold/burgundy by `data-theme` attribute (`:81-90`, comment at `:81-82`).
- **Extra keyframes/animations, showroom only**: `fade-in`, `scale-in`, `slide-up`, `pulse-soft`, `group-boundary-pulse` (seating-planner group highlighting), `marquee`/`marquee-vertical` (`showroom/tailwind.config.ts:116-149`).
- **Extra `boxShadow` tokens, showroom only**: `soft`, `elevated`, `glass`, `gold`, all driven by CSS vars (`showroom/tailwind.config.ts:162-167`).

### Recommendation for trainos

Copy the shared skeleton verbatim (CSS-variable color tokens, container, accordion keyframes, `tailwindcss-animate` plugin) — this is the correct pattern regardless of domain. Adopt showroom's **CSS-variable font indirection** (`var(--font-serif, fallback)`) over vern-vault's hardcoded literals if trainos will ever need runtime-configurable theming per tenant/customer; otherwise vern-vault's simpler literal fonts are fine. Skip the `wedding`/`brand` color groups and the wedding-specific keyframes (`group-boundary-pulse`, marquee) — add named token groups and keyframes as trainos actually needs them, following the same CSS-variable convention.

## 6. components.json (shadcn) and src/components/ui layout

Both `components.json` files (`showroom/components.json:1-20`, `vern-vault/components.json:1-20`) share the same shadcn schema/style settings: `"style": "default"`, `"rsc": false`, `"tsx": true`, `"tailwind": {"config": "tailwind.config.ts", "css": "src/index.css", "baseColor": "slate", "cssVariables": true, "prefix": ""}`.

They diverge entirely on **aliases**, which reflects each repo's folder convention:

| Alias | showroom (`showroom/components.json:14-18`) | vern-vault (`vern-vault/components.json:14-18`) |
|---|---|---|
| components | `@/shared/components` | `@/components` |
| utils | `@/lib/utils` | `@/lib/utils` (same) |
| ui | `@/shared/components/ui` | `@/components/ui` |
| lib | `@/lib` | `@/lib` (same) |
| hooks | `@/shared/hooks` | `@/hooks` |

showroom's own internal doc confirms this is deliberate and was a migration: `showroom/src/shared/CLAUDE.md:53-56` states `@/shared/components/ui/` is "the ONLY UI tree" as of 2026-08-01, after a prior `src/components/ui/` legacy tree was deleted and `components.json` repointed — i.e. showroom used to look like vern-vault's flat layout and migrated to the nested `shared/` layout as the app grew multiple features. This is corroborating evidence (verified against the actual `components.json` alias values above, which do read `@/shared/...`) that the flat layout (vern-vault's current state) is the natural **starting** point and the `shared/`-nested layout is the natural **scaled-up** state — not two competing conventions.

vern-vault's `src/components/ui` (confirmed present via `ls src/components` → `ui` at `vern-vault/src/components/ui`) holds the shadcn primitives directly; `src/components/` otherwise holds `MarketplaceModelViewer.tsx`, `NavLink.tsx`, `SplashScreen.tsx`, and grouped folders `empty/`, `events/`, `layout/`, `splash/`, `vehicles/` (domain-flavored components living alongside generic ones, not yet separated into a `shared/` vs `features/` split).

showroom's shadcn primitives live at `src/shared/components/ui/` (per the CLAUDE.md and the alias); `src/shared/components/` also holds `SEOHead.tsx` and other cross-cutting pieces.

### Recommendation for trainos

Start with the flat vern-vault-style layout (`@/components`, `@/components/ui`, `@/hooks`) — it's less ceremony for an early-stage app and shadcn's own CLI defaults line up with it. Plan the migration path to `@/shared/components(/ui)`, `@/shared/hooks` once trainos grows multiple independent feature areas (as `CLAUDE.md`'s "Consolidation over repetition" standing rule already anticipates for component patterns) — copy showroom's alias values at that point, and budget for a `components.json` alias change plus an import-path rewrite pass, since that's exactly what showroom's own history shows was required.

## 7. eslint.config.js and eslint.hooks.config.js

### eslint.config.js — same base, showroom adds project-specific bans

Both configs (`showroom/eslint.config.js`, `vern-vault/eslint.config.js`) are `typescript-eslint` flat configs built the same way:
- `{ ignores: [...] }` block (vern-vault ignores just `["dist"]`, `vern-vault/eslint.config.js:8`; showroom ignores `["dist", "supabase/functions", ".claude"]`, `showroom/eslint.config.js:12`, with inline comments explaining Supabase Edge Functions run on Deno and shouldn't be linted with browser rules, and `.claude` holds stray git worktrees that would double every finding).
- `extends: [js.configs.recommended, ...tseslint.configs.recommended]` on `files: ["**/*.{ts,tsx}"]`, `ecmaVersion: 2020`, `globals: globals.browser` — identical in both (`showroom/eslint.config.js:14-19`; `vern-vault/eslint.config.js:10-15`).
- Same plugins (`react-hooks`, `react-refresh`) and same rules: `...reactHooks.configs.recommended.rules`, `"react-refresh/only-export-components": ["warn", {allowConstantExport: true}]`, `"@typescript-eslint/no-unused-vars": "off"` — identical in both (`showroom/eslint.config.js:20-27`; `vern-vault/eslint.config.js:16-23`).

showroom then adds **two extra config blocks with custom `no-restricted-syntax` rules**, absent entirely from vern-vault:
1. A ban on calling `supabase.rpc(...)` directly anywhere except `src/lib/rpc.ts` (the wrapper itself) and `src/features/studio/saved-draft.ts` (a pre-existing allowlisted exception) — forcing all RPC calls through a typed `rpc()`/`rpcEnvelope()` wrapper so admin RPCs get `p_wedding_id` enforcement (`showroom/eslint.config.js:24-48`, task-038).
2. A ban on raw `guest.name` member access inside `src/features/**` and `src/components/**` (excluding the safe-reader implementation, a compat re-export, `*.types.ts` files, and the same `saved-draft.ts`) — because `strictNullChecks: false` means the compiler can't catch null crashes on a newly-nullable field, so this lint rule is a compensating control forcing use of a `displayName(guest, rsvp)` helper (`showroom/eslint.config.js:49-117`, task-039). The file's comments (`:66-77`) also explain a flat-config gotcha: later blocks with the same rule ID *replace* rather than merge earlier ones, so the task-038 selector had to be duplicated into this block to keep firing within the scoped globs.

These two rules are **domain-specific, ad hoc guardrails** tied to showroom's own past incidents (a Supabase RPC contract task and a nullable-guest-name incident) — not general scaffolding. They are, however, a good **pattern** to note: using `no-restricted-syntax` to compensate for a known type-safety gap (here, `strictNullChecks: false`) is reusable methodology even though the specific selectors are not.

### eslint.hooks.config.js — showroom only

`showroom/eslint.hooks.config.js:1-29` exists; vern-vault has no such file (confirmed: `ls eslint.hooks.config.js` → not found).

It is a **narrow, separate flat config** whose only job is `"react-hooks/rules-of-hooks": "error"` on `files: ["src/**/*.{ts,tsx}"]`, with `linterOptions: { reportUnusedDisableDirectives: "off" }` and its own `ignores: ["dist/**", "docs/_archive/**"]` (`:6-8`). It's invoked via `npm run lint:hooks` (`showroom/package.json:13`: `eslint src --config eslint.hooks.config.js`) and is part of the `verify:deploy` gate (`showroom/package.json:24`).

**What it's for:** it isolates the single highest-value, zero-false-positive-tolerance rule (rules-of-hooks violations are always real bugs) into its own fast, focused pass, independent of the main `eslint.config.js`'s broader and slower-evolving rule set. Running it separately in `verify:deploy` means a hooks violation fails fast and specifically, rather than being buried among warnings from the main lint pass.

### Recommendation for trainos

Copy the shared base `eslint.config.js` skeleton verbatim. Skip showroom's two `no-restricted-syntax` bans (they're reactive to showroom's own incidents) unless trainos hits the same class of problem — but keep the *technique* in mind. Adopt `eslint.hooks.config.js` early: it's cheap, general-purpose, and a real safety net (hooks-rule violations are consistently high-signal).

## 8. vitest.config.ts, vitest setup, and test conventions

### vitest.config.ts

Both use `defineConfig` from `vitest/config` with the `@vitejs/plugin-react-swc` plugin and the same `@` → `./src` alias (`showroom/vitest.config.ts:1-22`; `vern-vault/vitest.config.ts:1-14`). Both intentionally keep this **separate from `vite.config.ts`** rather than reusing it — showroom's file says so explicitly in a comment (`showroom/vitest.config.ts:5-10`): the main vite config has build-time-only concerns (manualChunks, esbuild `drop`, `lovable-tagger`) that don't belong in a test config, so the alias + react plugin slice is duplicated rather than shared.

Differences:
- **`globals`**: vern-vault sets `globals: true` (`vern-vault/vitest.config.ts:18`, no comment/rationale found in that file); showroom sets `globals: false` (`showroom/vitest.config.ts:31`) with an inline comment saying explicit `describe`/`it`/`expect` imports are preferred for clarity even though the runtime supports both (`:28-31`).
- **`setupFiles`**: vern-vault points to `./vitest.setup.ts` at the repo root (`vern-vault/vitest.config.ts:19`); showroom points to `./src/test/setup.ts` (`showroom/vitest.config.ts:27`) — different location convention, same purpose.
- **`include`**: vern-vault only picks up `src/**/*.{test,spec}.{ts,tsx}` (`vern-vault/vitest.config.ts:22`); showroom's pattern additionally includes `supabase/functions/**/*.{test,spec}.ts` (`showroom/vitest.config.ts:22`) — pure/runtime-agnostic Edge Function library tests, per its comment (`:21`).
- **`env`**: vern-vault has no test-time env overrides. showroom injects fake `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` values (`showroom/vitest.config.ts:26-29`) as a defensive guard, since `src/lib/supabase.ts` throws at import time if those are missing (confirmed: `showroom/src/lib/supabase.ts` throws when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — note vern-vault's equivalent module also throws under the same condition, see `vern-vault/src/lib/supabase.ts:13-17`).
- **`coverage`**: only showroom configures it (`showroom/vitest.config.ts:35-51`) — `provider: "v8"`, reporters `["text", "html", "json-summary"]`, `include`/`exclude` globs, and a comment noting thresholds are deliberately left unset as a ratchet-to-be-set-later rather than an immediate 80% wall (`:47-51`). vern-vault has no `coverage` block and no `@vitest/coverage-v8` dependency at all.

### vitest.setup.ts / src/test/setup.ts content

vern-vault's `vitest.setup.ts` (`vern-vault/vitest.setup.ts:1-9`) does two things: imports `@testing-library/jest-dom/vitest` for DOM matchers, and runs `cleanup()` from `@testing-library/react` in a global `afterEach` so rendered trees don't leak between tests.

showroom's `src/test/setup.ts` (`showroom/src/test/setup.ts:1-31`) imports the same jest-dom matchers, but instead of an RTL `cleanup()` call, it polyfills `window.matchMedia` when absent (jsdom doesn't implement it) — with a detailed comment (`:11-18`) explaining that the `/studio` entry flow's landing-v2 barrel pulls in `gsap`/`framer-motion` modules that probe `matchMedia` at *module load time*, before any test's `beforeAll` could stub it, so the polyfill has to live in the global setup file, not per-test.

### Test file conventions and locations

- Both repos colocate tests near source under `__tests__/` directories, using `.test.ts`/`.test.tsx` suffixes (confirmed via `find`: vern-vault has `src/features/admin/components/__tests__/AdminListings.test.tsx` and `src/features/inventory/hooks/__tests__/useAdminVehicles.test.tsx`; showroom has dozens, e.g. `src/lib/__tests__/rpc.test.ts`, `src/pages/__tests__/Index.portrait.test.tsx`, `src/features/seating/stores/__tests__/`).
- vern-vault currently has only 2 test files total; showroom has dozens spread across `src/__tests__/`, `src/pages/__tests__/`, `src/lib/__tests__/`, and per-feature `__tests__/` folders — reflecting project maturity, not a different convention.

### Recommendation for trainos

Use showroom's `globals: false` + explicit imports (clearer, matches most style guides) and `src/test/setup.ts` location. Skip the `matchMedia` polyfill and the Supabase env-var injection until trainos actually hits those specific failure modes — add them reactively, following the same pattern (a commented, targeted fix in the setup file), rather than pre-emptively copying code whose justification doesn't yet apply. Add the `@vitest/coverage-v8` + `coverage` block from day one (it's cheap and the "no threshold yet" ratchet pattern is good practice), and keep the `__tests__/` colocation convention.

## 9. src/ folder structure, path aliases, and data/hooks organization

### Path aliases — identical in both

Both use a single alias: `"@"` → `./src`, set in three places consistently in each repo: `vite.config.ts` (`resolve.alias`), `vitest.config.ts` (`resolve.alias`), and `tsconfig.json`/`tsconfig.app.json` (`compilerOptions.paths`). Confirmed identical across `showroom/vite.config.ts:13-17`, `showroom/vitest.config.ts:11-14`, `showroom/tsconfig.app.json:24-27` and the vern-vault equivalents.

### showroom — feature-folder structure (the scaled-up convention)

Top-level `src/` (`showroom` `ls src`): `App.tsx`, `main.tsx`, `index.css`, `vite-env.d.ts`, plus directories `__tests__/`, `components/` (legacy/thin, superseded per `src/shared/CLAUDE.md:53-56`), `features/`, `lib/`, `pages/`, `shared/`, `test/`.

- **`src/features/`** (11 features: `admin`, `dashboard`, `editor`, `guides`, `landing-v2`, `legal-docs`, `planned-guestlist`, `rsvp`, `seating`, `studio`, `svg-library`, `wishes`). Each feature is a self-contained folder with its own subset of: `types/`, `stores/` (Zustand), `utils/`, `schemas/` (Zod), `components/`, `hooks/`, `services/`, `presets/`, and a barrel `index.ts`. Example (`src/features/seating/`): `types/seating.types.ts`, five Zustand stores (`plannerStore.ts`, `floorStore.ts`, `venueLinesStore.ts`, `groupStore.ts`, `tableTagsStore.ts`) plus a selectors file, `utils/` (coordinates, snapshot, table naming, seat positions), `schemas/` (`floorElement.schema.ts`, `table.schema.ts`), and a `components/` folder with a nested `planner/` subfolder. Another feature (`src/features/inventory`-style pattern seen in vern-vault, or showroom's `src/features/wishes/hooks/useWishes.ts`) follows `types/ → schemas/ → hooks/ → services/` layering.
- Two features (`planned-guestlist`, `admin`) additionally have their own **`pages/`** subfolder (`src/features/planned-guestlist/pages`, `src/features/admin/pages`) — but most page-level route components live in the **top-level `src/pages/`** directory instead (15 files: `EditorPage.tsx`, `Index.tsx`, `LandingV2Page.tsx`, `RuntimeAdminPage.tsx`, `RuntimeWeddingPage.tsx`, `SeatingPlanner.tsx`, `StudioWorkspacePage.tsx`, `WeddingPage.tsx`, etc., plus a `__tests__/` folder). So the convention is: route-level page components default to top-level `src/pages/`, and only get pulled into a feature's own `pages/` folder when a feature owns a self-contained cluster of routes.
- **`src/shared/`** (the cross-cutting foundation layer, ~80+ files per its own `CLAUDE.md:3`): `components/` (with nested `ui/` for the full shadcn set, per components.json alias), `hooks/`, `lib/`, `config/` (wedding template config loaders), `context/`, `schemas/`, `stores/`, `queries/` (e.g. `weddingConfigQuery.ts`), `templates/`, `theme/`, `tier/`, `pricing/`, `security/`, `analytics/`, `auth/`, `bespoke/`, `data/`, `ops/`, `preview/`, `types/`, `utils/`, plus its own `CLAUDE.md` documenting the module.
- **`src/lib/`**: cross-cutting non-feature infra — `supabase.ts` (the Supabase client singleton, the ONLY place `createClient` is called per its own comment, `showroom/src/lib/supabase.ts` — feature *services* import this, components/hooks never import `@supabase/supabase-js` directly), `queryClient.ts` (TanStack Query client + a global `MutationCache.onError` handler wired to a `meta.toastOnError` convention, `showroom/src/lib/queryClient.ts:1-16`), plus `rpc.ts` and a family of `rpc.schemas.*.ts` files (the typed RPC wrapper the `eslint.config.js` `no-restricted-syntax` rule enforces, §7), `sessionErrorCoercion.ts`, `utils.ts`, `types/`.
- **`@tanstack/react-query` usage pattern**: hooks that need server state live inside each feature's own `hooks/` folder (e.g. `src/features/studio/hooks/useDraftLifecycle.ts` imports `useMutation`/`useQuery`/`useQueryClient` directly from `@tanstack/react-query`, composes feature-specific service functions, and even does a TanStack Query **module augmentation** — `declare module "@tanstack/react-query" { interface Register {...} }` — to add a typed `meta.toastOnError` flag with autocomplete, `showroom/src/features/studio/hooks/useDraftLifecycle.ts:35-40`, wired to the global `MutationCache.onError` in `src/lib/queryClient.ts`). There is no central `src/queries/` directory of hooks; query/mutation hooks are feature-owned.
- **Supabase client wrapper location**: `src/lib/supabase.ts` — a single top-level file, not inside `shared/` or a feature.

### vern-vault — flatter structure (the starting-point convention)

Top-level `src/` (`vern-vault` `ls src`): `App.tsx`, `main.tsx`, `index.css`, `vite-env.d.ts`, plus directories `components/`, `data/`, `features/`, `hooks/`, `lib/`, `pages/`, `types/`.

- **`src/features/`** has only 5 entries (`admin`, `auth`, `config`, `inventory`, `market`) — far fewer than showroom, and each is thinner. Example (`src/features/inventory/`): `types/index.ts`, `schemas/vehicle.schema.ts`, `hooks/` (`useAdminVehicles.ts`, `useVehicles.ts`, plus `__tests__/`), `lib/listingQuality.ts`, `services/` (`vehicleAdminService.ts`, `mediaService.ts`, `vehicleService.ts`) — same `types → schemas → hooks → services` layering pattern as showroom's features, just with fewer files per layer. This confirms the feature-internal layering convention (types/schemas/hooks/services, optionally components/stores/utils) is shared between the two repos; only the top-level `shared/` vs flat `components/`+`hooks/` split differs.
- **No `src/shared/` directory at all.** Cross-cutting UI lives directly at `src/components/` (shadcn `ui/` plus `MarketplaceModelViewer.tsx`, `NavLink.tsx`, `SplashScreen.tsx`, and grouped folders `empty/`, `events/`, `layout/`, `splash/`, `vehicles/`), and cross-cutting hooks live directly at `src/hooks/` (just `use-mobile.tsx`, `use-toast.ts` — the two standard shadcn scaffold hooks, nothing project-specific yet).
- **`src/lib/`**: `images.ts`, `jpjCodes.ts` (a domain-specific reference-data helper), `queryKeys.ts` (a centralized TanStack Query key registry — note showroom has no equivalent single file; showroom's query-key conventions, where present, live feature-locally, e.g. `src/features/seating/hooks/seatingKeys.ts`), `supabase.ts`, `utils.ts`.
- **Supabase client wrapper**: `src/lib/supabase.ts` (`vern-vault/src/lib/supabase.ts:1-25`) — same single-top-level-file convention as showroom. Content is nearly identical in intent: creates the client from `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, throws if either is missing, configures `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true` (needed for magic-link callback). Comment (`:3-5`) states it is "the ONLY place `createClient` is called (CLAUDE.md R1)" — same architectural rule as showroom, independently stated.
- **`@tanstack/react-query` usage pattern**: `App.tsx` creates its own `QueryClient` inline with no custom options (`const queryClient = new QueryClient();`, `vern-vault/src/App.tsx:31`) — no shared `lib/queryClient.ts`, no `MutationCache` error-toast wiring, no module augmentation. This is a materially less-developed pattern than showroom's.
- **Providers in `main.tsx`/`App.tsx`**: vern-vault's `main.tsx` is minimal (`createRoot(...).render(<App />)`, no providers at the root — `QueryClientProvider` presumably wraps lower in `App.tsx`, not shown at the head but implied by the inline `QueryClient` construction); showroom's `main.tsx` wraps in `HelmetProvider` at the root (for `react-helmet-async` OG/meta tag management) and imports an analytics-init side-effect module first, deliberately, before any React render (`showroom/src/main.tsx:1-16`).

### Recommendation for trainos

Adopt the **feature-internal layering** convention from both repos (types → schemas → hooks/stores → services/components, feature-owned, with a barrel `index.ts`) — this is the one convention proven identically in both repos regardless of scale. Start with vern-vault's **flat top-level structure** (`src/components`, `src/hooks`, no `shared/`) since trainos is new, and plan the `shared/` extraction (mirroring showroom's structure and the CLAUDE.md-documented migration) once cross-cutting code accumulates enough to justify it — do not pre-build an 80-file `shared/` tree on day one. Copy showroom's `lib/queryClient.ts` pattern (a shared `QueryClient` instance with a `MutationCache.onError` → toast convention driven by a typed `meta.toastOnError` flag) from the start — it is a small, generically valuable pattern, not tied to weddings, and vern-vault's inline per-component `QueryClient` is clearly the less mature choice, not a deliberate simplification worth keeping. Put the Supabase client singleton at `src/lib/supabase.ts` in both cases, confirmed by both repos independently converging on that location and on a "one createClient call site" rule.

## 10. index.html, render.yaml, .env conventions

### index.html

Both are static HTML shells with `<div id="root">` and `<script type="module" src="/src/main.tsx">` (`showroom/index.html:96-98`; `vern-vault/index.html:44-47`) — standard Vite entry. Both set full SEO/OG/Twitter meta tags, favicon links, and a Google Fonts `preconnect` + stylesheet pattern. showroom additionally documents (in an HTML comment, `showroom/index.html:64-77`) a deliberate choice to keep analytics OUT of `index.html` entirely — the analytics host is a deferred config token, and a hardcoded `<script>` tag here would bypass a redaction callback and a fail-safe-off default that are pinned by a fitness test; analytics gets injected at runtime from `src/shared/analytics/init.ts` instead, only when `VITE_ANALYTICS_HOST` is configured. showroom also inlines critical CSS for font-family FOUC prevention (`:79-93`); vern-vault does not.

### render.yaml — both deploy to Render as a static site, showroom's is far more hardened

vern-vault's `render.yaml` (`vern-vault/render.yaml:1-10`) is minimal: `type: web`, `runtime: static`, `name: revura`, `buildCommand: npm install && npm run build`, `staticPublishPath: ./dist`, and a single catch-all SPA rewrite route (`/*` → `/index.html`). No env vars, no headers.

showroom's `render.yaml` (`showroom/render.yaml:1-101`) adds substantially more:
- `buildCommand: npm ci && npm run verify:deploy && npm run build` (`:5`) — `npm ci` not `npm install`, and the full `verify:deploy` gate (typecheck + lint:hooks + typecheck:strict + test) runs as part of the Render build itself, not just in CI.
- `envVars: VITE_SITE_URL` set directly in `render.yaml` (`:11-13`), with a comment explaining this pins the canonical apex domain for share/invite links rather than falling back to the `onrender.com` alias.
- A `headers` block (`:37-86`) setting four security headers on `/*`: `Content-Security-Policy: frame-ancestors 'self'` (closes a documented clickjacking path — a concrete attack scenario is described in the comment, `:19-23`), `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin` (to avoid leaking wedding-slug URLs to third parties), `X-Content-Type-Options: nosniff`. Extensive comments describe what is deliberately NOT set yet (a full `script-src` CSP, an analytics CSP) and why, plus the exact mechanism (`buildAnalyticsCspHeaderValue()`) to add analytics-origin CSP later without hand-writing it.
- Three SPA rewrite routes instead of one (`:87-101`): explicit handling for an `/admin-lite/*` sub-path and the exact `/admin-lite` root, then the general catch-all — needed because of how that route tree is structured.

### .env conventions

- **vern-vault** has no `.env.example` file at all (confirmed: file does not exist). It has a real `.env` (gitignored per `vern-vault/.gitignore:19-26`... actually confirmed via a plain `grep -n env vern-vault/.gitignore`, showing `.env`/`.env.local`/`.env.*.local` ignored) containing exactly two vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (values redacted; confirmed via `grep -rohE "VITE_[A-Z_]+" src` that these two, plus `VITE_LEAD_PHOTO_DOORMAN_ENABLED`, are the only `VITE_*` tokens referenced anywhere in `vern-vault/src`).
- **showroom** has a committed `.env.example` (`showroom/.env.example:1-70`) that documents every var with extensive comments, explicitly framed as "the canonical source of what does the app need to run locally" (`:4-6`) — and a note that all `VITE_*` values are public-by-design (bundled into the client) and real secrets belong in Supabase Edge Function secrets, never in this file (`:8-10`). Vars documented: `VITE_SITE_URL` (canonical domain, with local/staging/prod values spelled out in comments, `:19-25`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (note: this is a *different* variable name than vern-vault's `VITE_SUPABASE_ANON_KEY` — showroom has moved to Supabase's newer "publishable key" terminology), and a block of five analytics vars (`VITE_ANALYTICS_HOST`, `_SCRIPT_ID`, `_SCRIPT_PATH`, `_API`, `_DOMAIN`) that are all commented out by default, with the comment block explaining the single-switch design (unset `VITE_ANALYTICS_HOST` ⇒ analytics is entirely absent) and pointing at `src/shared/analytics/analyticsConfig.ts` as the one place resolution logic lives. Grepping `showroom/src` for `VITE_[A-Z_]+` confirms actual usage matches: `VITE_ANALYTICS_API`, `_DOMAIN`, `_HOST`, `_SCRIPT_ID`, `_SCRIPT_PATH`, `VITE_SITE_URL`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `VITE_SUPABASE_URL` — the `.env.example` file is accurate and current against real usage.

### Recommendation for trainos

Adopt showroom's `.env.example` pattern from day one — committed, heavily commented, one canonical file — rather than vern-vault's undocumented approach; it costs nothing early and prevents "what env vars does this need" archaeology later. Start `render.yaml` at vern-vault's minimal shape (it's correct for a project with no security-sensitive routes yet), but plan to add showroom's four security headers (`Content-Security-Policy: frame-ancestors 'self'`, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`) as soon as trainos has any authenticated/admin surface — these are generic hardening, not wedding-specific, and cost nothing to add early rather than reactively. Use `npm ci` (not `npm install`) in the Render build command for reproducibility, and consider folding a `verify:deploy`-style gate into the build command once trainos has a typecheck/test suite worth gating on.

## Recommended for trainos — summary

**Copy verbatim:**
- Core dependency skeleton (React 18, Vite 5 + `@vitejs/plugin-react-swc`, React Router 6, TanStack Query 5, Supabase JS 2, Zod 3, React Hook Form 7, full shadcn/ui Radix set, Tailwind 3 + `tailwindcss-animate`, Vitest 2, ESLint 9 flat config, TypeScript 5.8).
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` (identical in both source repos already).
- `postcss.config.js`.
- The shadcn `components.json` schema/tailwind block (only the `aliases` differ by structure choice, see below).
- The CSS-variable-driven Tailwind color-token pattern, container/keyframes/`tailwindcss-animate` skeleton.
- The `@` → `./src` alias set in `vite.config.ts` + `vitest.config.ts` + `tsconfig.app.json` together.
- Feature-internal layering convention: `types/ → schemas/ → hooks|stores/ → services|components/`, barrel `index.ts` per feature.
- Supabase client singleton at `src/lib/supabase.ts`, "one `createClient()` call site" rule.
- `.env.example` pattern (committed, documented, canonical) — follow showroom's format.
- `vitest.setup.ts` importing `@testing-library/jest-dom/vitest`.

**Adapt (start simple, grow toward showroom's version):**
- Folder layout: start flat (vern-vault: `src/components`, `src/hooks`, no `shared/`); plan the `shared/` extraction once cross-cutting code accumulates.
- `components.json` aliases: start with `@/components`, `@/components/ui`, `@/hooks`; migrate to `@/shared/...` later (this is a proven real migration path, not a hypothetical).
- `vite.config.ts`: start with vern-vault's minimal version; add showroom's production-only `esbuild.drop` console/debugger stripping immediately (cheap, generic); defer `manualChunks`/`optimizeDeps.include` until there's a real dev-reload-thrash problem to solve.
- `render.yaml`: start minimal; add showroom's four security headers as soon as an authenticated surface exists; use `npm ci` over `npm install`.
- TanStack Query setup: adopt a shared `src/lib/queryClient.ts` with a `MutationCache.onError` → toast convention (small, valuable, not wedding-specific) instead of vern-vault's inline per-app `QueryClient`.
- `tsconfig.strict.json` graduated-allowlist ratchet: adopt from day one with an empty (or near-empty) `include` list; it only gets harder to retrofit later.
- Test scripts: start with vern-vault's 7-script minimal set; add `typecheck`, `format`/`format:check`, `test:coverage` early; add `lint:hooks`/`typecheck:strict`/budget-ratchet scripts only once their corresponding config exists.

**Drop / do not copy:**
- All wedding-specific and car-marketplace-specific dependencies (dnd-kit, gsap-heavy animation stack, d3, swiper, lenis, ogl, html-to-image/react-to-print/exceljs, `@google/model-viewer`, `cobe`, `effect`/`@niklaserik/effect-mcp`, `react-imask`) — pull in individually only when a concrete trainos feature needs them.
- showroom's two domain-specific `no-restricted-syntax` ESLint bans (Supabase RPC wrapper enforcement, nullable-guest-name guard) — the technique (compensating lint rule for a known type-safety gap) is reusable, the specific rules are not.
- k6 load tests, `fallow` dead-code auditing, `.dependency-cruiser.cjs` architecture graph, bundle/compositor budget ratchets, and all Supabase-migration-specific scripts (`check:rpc`, `check:grants`, `check:applied`, `check:edge`, `lint:sql`) — these are mature-project tooling, explicitly out of scope for this document, and premature for a new repo.
- `wedding`/`brand` Tailwind color token groups and wedding-specific keyframes (`group-boundary-pulse`, marquee) — add named tokens as trainos's own design system needs them.

## What I could NOT verify

- The exact behavior of `showroom/scripts/dev-fresh.mjs`, `scripts/generate-demos.js`, `scripts/guard.mjs`, `scripts/compositor-budget-check.mjs`, `scripts/bundle-budget-check.mjs`, `scripts/optimize-assets.mjs`, `scripts/rpc-contract-check.js`, `scripts/check-grants.mjs`, `scripts/check-applied.mjs`, `scripts/check-edge-deploy.mjs`, and `tools/sql-lint.mjs` — their file contents were not read (explicitly out of scope: CI/guardrails/Supabase tooling), so the script table above describes only what the `package.json` command line says each script invokes, not its internal logic.
- Whether vern-vault's `render.yaml` `name: revura` reflects a prior/internal project name versus the "Vern Motors" branding seen in `index.html` and `package.json` — flagged as a naming inconsistency but not investigated further (out of scope; this file documents config shape, not product branding history).
- The full contents of `showroom/AGENTS.md` and other docs/conventions files were not read, per the task's explicit non-goal excluding docs conventions.
- Whether vern-vault's `src/lib/queryKeys.ts` (a centralized query-key file) reflects an intentional, superior pattern to showroom's feature-local key files (e.g. `seatingKeys.ts`) or simply reflects vern-vault's smaller number of features not yet needing decentralization — the file's contents were not read in detail, only its existence and path noted.
- Full contents of `showroom/src/App.tsx` and `vern-vault/src/App.tsx` beyond the head/provider-setup region shown above were not read line-by-line; the provider-stack comparison (HelmetProvider, QueryClientProvider placement) is based on the visible headers only.
