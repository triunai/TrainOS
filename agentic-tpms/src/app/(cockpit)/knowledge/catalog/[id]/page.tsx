import Link from "next/link";
import { notFound } from "next/navigation";
import { Body, DefinitionList, RecordHeader, Section } from "@/components/kit";
import { Frame } from "@/components/shell/Frame";
import { plain } from "@/server/actions";
import { BLOOM_LEVELS, getCourse, listCourses, type BloomLevel } from "@/server/knowledge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Course" };

const SENIORITY_LABEL: Record<string, string> = { EXECUTIVE: "Executive", SUPERVISORY: "Supervisory", OPERATIONAL: "Operational" };

/** The master outline is "# Title / ## Module n: Name / - topic" markdown; render it as structure, not prose. */
function parseOutline(markdown: string): Array<{ title: string; topics: string[] }> {
  const modules: Array<{ title: string; topics: string[] }> = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) modules.push({ title: line.slice(3).replace(/^Module \d+:\s*/i, ""), topics: [] });
    else if (line.startsWith("- ") && modules.length) modules[modules.length - 1].topics.push(line.slice(2));
  }
  return modules;
}

export default async function CoursePage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const row = await getCourse(params.id);
  if (!row) notFound();
  // The 1536-d vector is a search index, not page content.
  const { syllabusEmbedding, ...course } = row;
  const c = plain(course);
  const all = await listCourses();
  const summary = all.find((x) => x.id === c.id);
  const next = c.nextCourseCode ? all.find((x) => x.courseCode === c.nextCourseCode) : undefined;
  const before = all.filter((x) => x.nextCourseCode === c.courseCode);
  const modules = parseOutline(c.masterOutlineMarkdown);
  const levels = c.learningOutcomes.map((o) => o.bloomLevel);
  const minL = Math.min(...levels);
  const maxL = Math.max(...levels);

  return (
    <Frame crumbs={[{ label: "Knowledge" }, { label: "Course catalog", href: "/knowledge/catalog" }, { label: c.courseCode }]}>
      <RecordHeader
        title={c.title}
        meta={[c.hrdFocusArea, `${SENIORITY_LABEL[c.targetSeniority] ?? c.targetSeniority} · level ${c.level}`, c.matchedNossCode ? `${c.matchedNossCode} (illustrative)` : null, c.hrdcProgrammeId ? `HRD Corp programme ${c.hrdcProgrammeId}` : null]}
        metrics={[
          { label: "Duration", value: `${c.durationDays} day${c.durationDays === 1 ? "" : "s"}` },
          { label: "Learning outcomes", value: String(c.learningOutcomes.length), sub: levels.length ? `Bloom L${minL}–L${maxL}` : undefined },
          { label: "Modules", value: String(modules.length) },
          { label: "Packages built on it", value: String(summary?.packages ?? 0) },
        ]}
      />
      <Body>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section eyebrow="Form HRD-L&D · Bloom's revised taxonomy" title="Learning outcomes">
              <ul className="flex flex-col gap-2 text-[13px]">
                {c.learningOutcomes.map((o, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-24 shrink-0 font-mono text-[11px] leading-5 text-ink-muted">
                      L{o.bloomLevel} {BLOOM_LEVELS[o.bloomLevel as BloomLevel] ?? ""}
                    </span>
                    <span>
                      <span className="font-semibold">{o.verb}</span> {o.outcome.replace(new RegExp(`^${o.verb}\\s*`, "i"), "")}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section eyebrow="Master outline" title={`${modules.length} modules`}>
              <ol className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
                {modules.map((m, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <p className="text-[13px] font-medium text-ink">
                      {i + 1}. {m.title}
                    </p>
                    <ul className="flex flex-col gap-0.5 pl-4 text-[12px] text-ink-secondary">
                      {m.topics.map((t) => (
                        <li key={t} className="list-disc">{t}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </Section>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Section title="Curriculum ladder">
              <DefinitionList
                items={[
                  ["Comes after", before.length ? before.map((b) => <Link key={b.id} href={`/knowledge/catalog/${b.id}`} className="block text-primary-hover hover:underline">{`${b.courseCode} · ${b.title}`}</Link>) : "entry course"],
                  ["Leads to", next ? <Link href={`/knowledge/catalog/${next.id}`} className="text-primary-hover hover:underline">{`${next.courseCode} · ${next.title}`}</Link> : c.nextCourseCode ?? "top of the ladder"],
                ]}
              />
              <p className="pt-2 text-[12px] text-ink-muted">The T+90 retention cadence proposes the next rung to clients who completed this course.</p>
            </Section>
            <Section title="Search index">
              <DefinitionList
                items={[
                  ["Syllabus vector", syllabusEmbedding ? "embedded · 1536 dimensions" : "not embedded"],
                  ["Model", c.embeddingModel ?? "—"],
                  ["NOSS reference", c.matchedNossCode ? `${c.matchedNossCode} — illustrative placeholder, not a JPK code` : "—"],
                ]}
              />
            </Section>
          </div>
        </div>
      </Body>
    </Frame>
  );
}
