# Stack and configuration

Everything in this file is `PLATFORM=web`. For mobile, reuse §2's script philosophy and
skip the rest — there is no verified mobile config in this skill.

Replace `{{PROJECT}}` with the project's kebab-case name. Nothing else in these files is
project-specific.

---

## 1. Dependencies

### Core — install these

Both reference repos converged on this exact skeleton independently. Copy it verbatim.

**Runtime:**

```
react@^18.3.1  react-dom@^18.3.1
react-router-dom@^6.30.1
@tanstack/react-query@^5.83.0
@supabase/supabase-js@^2.106.1
zod@^3.25.76
react-hook-form@^7  @hookform/resolvers@^3
class-variance-authority  clsx  tailwind-merge  tailwindcss-animate
lucide-react@^0.462.0
sonner
date-fns
next-themes
```

Plus the shadcn/ui Radix primitive set (~28 `@radix-ui/react-*` packages). Install those
through `npx shadcn@latest add <component>` rather than by hand — the CLI writes the
component file and the dependency together.

**Dev:**

```
typescript@~5.8  @types/node  @types/react  @types/react-dom
vite@^5  @vitejs/plugin-react-swc
tailwindcss@^3  postcss  autoprefixer
eslint@^9  @eslint/js  typescript-eslint  eslint-plugin-react-hooks  eslint-plugin-react-refresh  globals
vitest@^2  jsdom  @vitest/coverage-v8
@testing-library/react  @testing-library/jest-dom  @testing-library/dom
prettier  lint-staged
lefthook  @commitlint/cli  @commitlint/config-conventional
dependency-cruiser
```

### Optional — add only when a concrete need exists

| Package | Add when |
|---|---|
| `zustand` | client state outgrows React context and query cache |
| `framer-motion` **or** `motion` | real motion design, never both |
| `@dnd-kit/*` | drag-and-drop |
| `recharts` | charts |
| `exceljs` / `papaparse` | spreadsheet or CSV export |
| `libphonenumber-js` | phone validation |
| `react-imask` | input masking |
| `vite-bundle-visualizer` | investigating a bundle-budget regression |
| `libpg-query` | SQL parse-linting migrations (see `references/guardrails.md` §7) |
| `@tailwindcss/typography` | long-form prose surfaces |

**Do not install**: any functional-effects runtime (`effect` and friends). See the
non-negotiables in `SKILL.md`. One source repo wrapped every Supabase call in it and had
to write a helper whose entire job was undoing the wrapper before the query library could
read the error. The more mature repo has none of it.

**`lovable-tagger`**: both source repos carry this because they were scaffolded by that
tool. A repo not created that way should omit it and drop the `componentTagger()` line
from `vite.config.ts`.

---

## 2. package.json scripts

Start with the floor, add the rest as its config lands. Everything here is referenced by
a later step, so write the whole block now — a missing script makes a hook or CI job fail
in a way that reads as a real defect.

```json
{
  "name": "{{PROJECT}}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:dev": "vite build --mode development",
    "preview": "vite preview",
    "lint": "eslint .",
    "lint:hooks": "eslint src --config eslint.hooks.config.js",
    "typecheck": "tsc -p tsconfig.app.json --noEmit",
    "typecheck:strict": "tsc -p tsconfig.strict.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "verify:deploy": "npm run typecheck && npm run lint:hooks && npm run typecheck:strict && npm run test",
    "guard": "node scripts/guard.mjs",
    "guardrails:on": "node scripts/guard.mjs on",
    "guardrails:off": "node scripts/guard.mjs off",
    "guardrails:status": "node scripts/guard.mjs status",
    "arch:graph": "depcruise src --validate .dependency-cruiser.cjs --ignore-known --cache",
    "arch:baseline": "depcruise src --validate .dependency-cruiser.cjs --output-type baseline > .dependency-cruiser-known-violations.json",
    "bundle:check": "node scripts/bundle-budget-check.mjs",
    "bundle:baseline": "node scripts/bundle-budget-check.mjs --baseline",
    "bundle:analyze": "vite-bundle-visualizer",
    "sast": "semgrep scan --config .semgrep/rules.yml",
    "prepare": "lefthook install"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": ["prettier --write"],
    "*.{json,md,yml,yaml,css,html}": ["prettier --write"]
  }
}
```

Add when Supabase lands (`references/supabase.md`): `lint:sql`, `check:rpc`,
`check:grants`, `check:applied`, `check:edge`.

`verify:deploy` is the single gate name. CI runs its parts as separate jobs for a
readable matrix; the deploy build runs the whole thing as one command.

---

## 3. vite.config.ts

Minimal base plus the one production-only addition worth having from day one: stripping
`console.*` and `debugger` from production builds.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Strip console.* and debugger from production builds; keep them in dev.
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  build: {
    minify: "esbuild",
    target: "es2020",
    sourcemap: mode === "development",
    chunkSizeWarningLimit: 500,
  },
}));
```

**Defer, do not pre-build**, two things the mature repo added reactively:

- `build.rollupOptions.output.manualChunks` — named vendor splits. Add when the bundle
  budget shows a chunk worth isolating, not before; chunk names tied to packages you have
  not installed are dead config.
- `optimizeDeps.include` — an explicit pre-bundle allowlist. Add the moment you hit the
  symptom it fixes: first dev load fine, next reload hangs white for several seconds
  because Vite discovered a heavy dependency behind a lazy route mid-session and
  re-optimized. List every heavy dependency a lazy route or splash pulls in. Dev-only; the
  production build never re-optimizes.

---

## 4. TypeScript configs

Four files. The first three are identical across both source repos — safe baseline. The
fourth is the ratchet and is the reason this whole step is non-negotiable.

### tsconfig.json

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "noImplicitAny": false,
    "noUnusedParameters": false,
    "skipLibCheck": true,
    "allowJs": true,
    "noUnusedLocals": false,
    "strictNullChecks": false
  }
}
```

### tsconfig.app.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitAny": false,
    "noFallthroughCasesInSwitch": false,

    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

### tsconfig.node.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
```

### tsconfig.strict.json — the graduated allowlist ratchet

Write this on day one with an empty graduate list. It costs nothing now. Retrofitting it
onto a codebase with a hundred pre-existing null-safety gaps is a project.

```json
{
  // Per-file strict TypeScript ratchet.
  //
  // tsconfig.app.json has strictNullChecks off because flipping strict on
  // globally would surface every legacy issue at once. This config is the
  // GRADUATION ALLOWLIST — a file that has been audited and passes strict mode
  // gets added to `include` below. CI runs `npm run typecheck:strict`, which
  // only checks files in this allowlist.
  //
  // Workflow:
  //   1. Pick a file. Add its path here temporarily and run
  //        npx tsc -p tsconfig.strict.json --noEmit
  //   2. Fix every strict error in that file (or its small dependency tree).
  //   3. Commit the path here permanently. CI now enforces strict for that
  //      file forever; a regression elsewhere cannot loosen it.
  //
  // New code should be strict-by-default: add the path as soon as the file
  // is created, before it has anything to fix.
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUncheckedIndexedAccess": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noEmit": true
  },
  "include": [
    // Ambient declarations. NOT a graduate — this `include` REPLACES the base
    // config's ["src"], so vite-env.d.ts (which augments ImportMetaEnv) would
    // otherwise be absent from the strict program and every `import.meta.env`
    // in a graduate's dependency tree fails with TS2339.
    "src/vite-env.d.ts"
    // Graduates go below, one path per line, newest last.
  ]
}
```

`noUncheckedIndexedAccess` stays off deliberately — it is a much wider behavioural change
than the rest of the strict family and would stall graduations.

---

## 5. Tailwind and PostCSS

### postcss.config.js

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### tailwind.config.ts

Every semantic colour is a CSS custom property so the actual values live in
`src/index.css` and a theme can be swapped without touching Tailwind. Fonts go through
the same indirection with a literal fallback, which costs nothing now and is the only way
to get runtime-configurable theming later without a rewrite.

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1400px",
      },
    },
    extend: {
      // Fonts route through CSS variables with literal fallbacks. The fallback
      // is the real default; the variable exists so a theme surface can
      // override it at runtime without every other surface changing.
      fontFamily: {
        sans: ['var(--font-sans, "Inter", system-ui, sans-serif)'],
        serif: ['var(--font-serif, Georgia, serif)'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

If `DESIGN_PACK` was supplied, add its named token groups here following the same
`hsl(var(--token))` convention, and write the actual values into `src/index.css`. Do not
invent a second colour mechanism alongside this one.

---

## 6. components.json (shadcn/ui)

Flat aliases to start. The nested `@/shared/...` layout is where this ends up, but that
migration is a real cost (alias change plus an import rewrite pass) and should be paid
when cross-cutting code actually accumulates, not on day one.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

**Migration trigger**: when three or more independent feature areas exist and
`src/components` holds more cross-cutting than feature-agnostic code, move to
`@/shared/components`, `@/shared/components/ui`, `@/shared/hooks` and rewrite imports in
one pass. That is the path the mature repo actually took.

---

## 7. ESLint — two configs

### eslint.config.js

```js
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // supabase/functions runs on Deno (jsr imports, Deno globals) — it has its
  // own typecheck and must not be linted with browser rules. .claude holds
  // tooling state including git worktrees (full repo copies) that would double
  // every finding.
  { ignores: ["dist", "supabase/functions", ".claude"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
```

### eslint.hooks.config.js

A separate, narrow config carrying the single highest-signal rule. Hook-order violations
are always real bugs, so this pass is blocking while the broad lint above stays advisory
until its baseline is clean.

```js
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "docs/_archive/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
```

### The `no-restricted-syntax` technique

Do not copy the source repo's specific bans — they are reactions to its own incidents.
Do keep the technique: when a known type-safety gap exists that the compiler cannot see
(a field that became nullable while `strictNullChecks` is off, a wrapper that must be the
only call site for something), a scoped `no-restricted-syntax` selector is the
compensating control. One flat-config gotcha worth knowing in advance: a later config
block with the same rule id **replaces** rather than merges the earlier one, so a
selector that must keep firing inside a narrower scope has to be repeated in that block.

---

## 8. Vitest

### vitest.config.ts

Deliberately separate from `vite.config.ts`. The build config carries concerns
(chunk splitting, console stripping) that do not belong in a test run; duplicating the
alias and plugin slice is cheaper than coupling them.

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Explicit describe/it/expect imports are preferred — clearer, and no
    // tsconfig types[] fiddling. The runtime supports both.
    globals: false,
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // src/lib/supabase.ts throws at import time when these are missing. This
    // guards against a transitive import pulling in the real client mid-run.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/test/**",
        "src/**/*.types.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      // Thresholds start unset on purpose — a ratchet, not a wall. Set the
      // first floor once ~5-10 tests have landed and raise it as coverage
      // grows. An 80% threshold on day one kills test culture before it forms.
    },
  },
});
```

Add `"supabase/functions/**/*.{test,spec}.ts"` to `include` once Edge Functions exist with
pure, runtime-agnostic library tests.

### src/test/setup.ts

```ts
// Global test setup. jest-dom matchers (toBeInTheDocument, etc.) plus a
// cleanup after every test so rendered trees do not leak between cases.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

Two polyfills to add **reactively**, not now, each with a comment explaining what broke:

- `window.matchMedia` — jsdom does not implement it, and a motion library probing it at
  module load time will fail before any `beforeAll` could stub it. When that happens, the
  polyfill has to live here in global setup, not per-test.
- Any other module-load-time browser API a dependency touches.

### Test conventions

Colocate under `__tests__/` next to the source, `.test.ts` / `.test.tsx`.

---

## 9. Prettier, EditorConfig, env

### .prettierrc.json

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "arrowParens": "always",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

### .prettierignore

```
dist
build
node_modules
coverage

package-lock.json
*.lock

.github

supabase/migrations
supabase/rollbacks
supabase/tests
public

CHANGELOG.md
```

Migrations, rollbacks and SQL tests are excluded because reformatting SQL that has been
executed against a database makes the file stop matching what actually ran.

### .editorconfig

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.{yml,yaml}]
indent_size = 2

[*.sql]
indent_size = 4
```

### .env.example — committed, documented, canonical

```
# {{PROJECT}} — local environment
#
# This file is the canonical answer to "what does the app need to run locally".
# Copy to .env and fill in. Commit changes to THIS file whenever a new variable
# is introduced.
#
# Every VITE_* value is PUBLIC BY DESIGN: Vite inlines it into the client
# bundle at build time. Real secrets belong in server-side secret storage, never
# here and never in any VITE_ variable.

# Canonical origin for share links, callbacks and absolute URLs.
#   local:   http://localhost:8080
#   prod:    https://<your-domain>
VITE_SITE_URL=http://localhost:8080

# Supabase project.
# Use the new publishable key format (sb_publishable_...), not the legacy anon JWT.
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Keep this accurate. Grep `src` for `VITE_[A-Z_]+` after any env change and reconcile.

---

## 10. render.yaml — hardened static deploy

```yaml
services:
  - type: web
    runtime: static
    name: {{PROJECT}}
    # npm ci, not npm install — reproducible from the lockfile.
    # verify:deploy runs the same gates CI runs, so the deploy step is a second
    # independent enforcement rather than trusting a green CI badge. This
    # matters while branch protection is not yet on.
    buildCommand: npm ci && npm run verify:deploy && npm run build
    staticPublishPath: dist

    envVars:
      - key: VITE_SITE_URL
        value: https://<your-domain>

    # Security headers. The concrete attack frame-ancestors closes: a signed-in
    # operator, an attacker's page framing an authenticated admin route
    # invisibly under a decoy button, one click landing on a destructive
    # control. There is no frame-busting script in a plain SPA, so framing is
    # otherwise unrestricted.
    #
    # 'self' rather than 'none' deliberately: it fully closes the cross-origin
    # path (the attacker's page is by definition another origin) while leaving
    # same-origin framing available for legitimate embeds.
    #
    # NOT set here: a full script-src CSP. That needs its own pass with real
    # testing against the actual asset origins; shipping a broken one takes the
    # site down. Add it as a SECOND Content-Security-Policy header on the same
    # path when you do — same-name headers coalesce, so it adds to
    # frame-ancestors rather than replacing it.
    headers:
      - path: /*
        name: Content-Security-Policy
        value: frame-ancestors 'self'
      # For engines that do not honour frame-ancestors. SAMEORIGIN agrees with
      # 'self' above rather than contradicting it.
      - path: /*
        name: X-Frame-Options
        value: SAMEORIGIN
      # Paths can carry record slugs and are shared over chat apps; do not leak
      # the full path to third-party origins.
      - path: /*
        name: Referrer-Policy
        value: strict-origin-when-cross-origin
      - path: /*
        name: X-Content-Type-Options
        value: nosniff

    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

Add a more specific rewrite **above** the catch-all for any route family that needs one
(both the sub-path form `/section/*` and the exact root `/section`).

---

## 11. src skeleton

```
src/
  main.tsx
  App.tsx
  index.css              # CSS custom properties: every --token tailwind.config references
  vite-env.d.ts
  components/            # cross-cutting UI
    ui/                  # shadcn primitives, written by the CLI
    states/              # the empty/loading/error kit — see app-architecture.md
    fields/              # the form-field kit — see app-architecture.md
  hooks/                 # cross-cutting hooks
  lib/
    supabase.ts          # the ONLY createClient call site
    queryClient.ts       # shared QueryClient + MutationCache error routing
    rpc.ts               # the typed RPC wrapper
    rpc.types.ts         # RpcMap
    queryKeys.ts         # hierarchical key factory
    utils.ts
  features/
    <name>/
      index.ts           # the public barrel — the ONLY entry other features may import
      types/
      schemas/
      hooks/
      services/
      components/
  pages/                 # route-level components
  test/
    setup.ts
```

Feature-internal layering (`types → schemas → hooks/stores → services/components`, with a
barrel) is the one convention both source repos follow identically regardless of scale.
Adopt it from the first feature — `.dependency-cruiser.cjs` enforces the barrel boundary
and has nothing to enforce without it.

---

## 12. What deliberately is not here

Dropped because it was domain-specific, unverified, or premature for a new repo:

- Load-test suites. Add when there is a rate-limited or latency-sensitive surface worth
  testing; the safety-contract discipline to copy then is in `references/guardrails.md` §9.
- Dead-code auditing CLIs. Useful, third-party, and easy to add later.
- A compositor/CSS-cost budget. The ratchet technique is in `references/guardrails.md` §6;
  the scan roots and offending-property list must be written for this project's own risk.
- Image optimization and static preview-page generation pipelines. Entirely
  content-specific.
- A second toast library alongside the first. One source repo mounts two; that is debt,
  not a pattern.
