/**
 * Screenshot gallery of every cockpit screen, for the README and for review.
 *
 *   npm run screenshots -- [--base http://localhost:3100] [--out test-results/screenshots] [--dark]
 *
 * The full run (every screen, ~100 per theme) goes to a gitignored folder;
 * the README's curated set lives in docs/screenshots.
 *
 * Reads the nav tree (src/lib/nav.ts), so a screen added to the nav is captured
 * without editing this file. Package-record tabs are captured for the first
 * package found at each of a few interesting stages. A page that answers with an
 * HTTP error, or that renders the Next error overlay, fails the run: a gallery
 * that silently photographs a crash is worse than no gallery.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { NAV } from "../src/lib/nav";
import { loadDotEnv } from "../src/server/env";

loadDotEnv();

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (flag("base") ?? process.env.TPMS_PUBLIC_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const OUT = flag("out") ?? "test-results/screenshots";
const THEMES: Array<"light" | "dark"> = args.includes("--dark") ? ["light", "dark"] : ["light"];
const CHROME = process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PACKAGE_TABS = ["", "commercials", "grant", "logistics", "participants", "attendance", "claims", "audit"];

function slug(route: string): string {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "");
}

async function packageCodes(): Promise<Array<{ code: string; stage: string }>> {
  const { rows, db } = await import("../src/server/db/client");
  const { sql } = await import("drizzle-orm");
  const { closePool } = await import("../src/server/db/pool");
  try {
    return await rows<{ code: string; stage: string }>(
      db(),
      sql`select distinct on (operational_stage) package_code as code, operational_stage as stage
            from tpms.training_packages
           order by operational_stage, created_at desc`,
    );
  } finally {
    await closePool();
  }
}

async function capture(page: Page, route: string, file: string): Promise<string | null> {
  // Not "networkidle": cockpit pages hold an EventSource (/api/v1/events) open
  // on purpose, so the network never goes idle. Load, then let it settle.
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 60_000 });
  const status = response?.status() ?? 0;
  if (status >= 400) return `${route} answered HTTP ${status}`;
  if (await page.locator("nextjs-portal, [data-nextjs-dialog]").count()) return `${route} rendered the Next error overlay`;
  // The cockpit is a fixed-height app shell: the document itself must never
  // scroll sideways. An absolutely positioned descendant with no positioned
  // ancestor escapes overflow clipping and does exactly that (found on the
  // board: off-screen cards' sr-only labels).
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 1) return `${route} scrolls sideways by ${sideways}px`;
  // The Univer canvas and live refresh settle after network idle.
  await page.waitForTimeout(route.includes("commercials") || route.includes("attendance") ? 3000 : 800);
  // The cockpit scrolls inside its own panel, not the document, so a
  // "full page" capture stops at the viewport. Grow the viewport to the
  // panel's content first (capped), capture, then restore it.
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const hidden = await page.evaluate(() =>
    Math.max(
      0,
      ...Array.from(document.querySelectorAll<HTMLElement>("main, main *"))
        .filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY))
        .map((el) => el.scrollHeight - el.clientHeight),
    ),
  );
  if (hidden > 0) {
    await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height + hidden, 8000) });
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: file, fullPage: true });
  if (hidden > 0) await page.setViewportSize(viewport);
  return null;
}

async function main() {
  const routes = new Set<string>();
  for (const group of NAV) {
    for (const parent of group.parents) {
      if (parent.path) routes.add(parent.path);
      for (const child of parent.children) routes.add(child.path);
    }
  }
  const packages = await packageCodes();
  for (const p of packages) for (const tab of PACKAGE_TABS) routes.add(`/operations/${p.code}${tab ? `/${tab}` : ""}`);

  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const failures: string[] = [];
  let taken = 0;
  try {
    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript((t) => window.localStorage.setItem("tpms.theme", t), theme);
      const page = await context.newPage();
      for (const route of routes) {
        const file = path.join(OUT, `${slug(route)}${theme === "dark" ? ".dark" : ""}.png`);
        const problem = await capture(page, route, file).catch((e: unknown) => `${route}: ${e instanceof Error ? e.message : String(e)}`);
        if (problem) failures.push(problem);
        else taken += 1;
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`${taken} screenshots written to ${OUT}`);
  if (failures.length) {
    console.error(`${failures.length} screen(s) failed:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
