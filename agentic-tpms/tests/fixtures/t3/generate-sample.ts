/**
 * Regenerates the committed sample Form T3 templates from the REAL renderer
 * (no database needed), for the Python service's pytest suite:
 *
 *   npx tsx tests/fixtures/t3/generate-sample.ts
 *
 * Writes tests/fixtures/t3/sample-template-{6,15,20}.pdf and copies them to
 * services/paddleocr/tests/fixtures/. Re-run it whenever t3Template.ts
 * geometry changes, so both halves of the layout contract test the same page.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDotEnv } from "@/server/env";
import { renderT3TemplatePdf } from "@/server/attendance/t3Template";

loadDotEnv();

const PACKAGE_ID = "0b5e8f3e-2a41-4d7c-9a51-7c1f00d3a001";

function participant(i: number) {
  const hex = (1000 + i).toString(16).padStart(12, "0");
  return { id: `5a1d7c20-0000-4000-8000-${hex}`, name: `Sample Participant ${String(i + 1).padStart(2, "0")}`, nricMasked: `******-**-${String(1000 + i).slice(-4)}` };
}

async function main() {
  const here = path.resolve("tests/fixtures/t3");
  const service = path.resolve("services/paddleocr/tests/fixtures");
  mkdirSync(service, { recursive: true });
  for (const n of [6, 15, 20]) {
    const bytes = await renderT3TemplatePdf({
      pkg: { id: PACKAGE_ID, packageCode: "PKG-2026-0042", title: "Leading Through Change", etrisGrantId: "ETRIS-2026-001234", durationDays: 2 },
      clientName: "Kenanga Retail Group Berhad",
      trainerName: "Farah Aziz",
      venueName: "Sunway Pyramid Convention Centre, Petaling Jaya",
      dayIndex: 1,
      date: "2026-10-20",
      participants: Array.from({ length: n }, (_, i) => participant(i)),
    });
    const file = path.join(here, `sample-template-${n}.pdf`);
    writeFileSync(file, bytes);
    copyFileSync(file, path.join(service, `sample-template-${n}.pdf`));
    console.log(`wrote ${file} (${bytes.byteLength} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
