import Link from "next/link";
import { Body, DataTable, LINK_BUTTON, MiniBar, PageHeader, SecondaryButton, StatusChip, TextInput } from "@/components/kit";
import { Frame } from "@/components/shell/Frame";
import { LOCAL_EMBEDDING_MODEL } from "@/server/ai";
import { BLOOM_LEVELS, listCourses, searchCourses, type CourseHit } from "@/server/knowledge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Course catalog" };

const SENIORITY_LABEL: Record<string, string> = { EXECUTIVE: "Executive", SUPERVISORY: "Supervisory", OPERATIONAL: "Operational" };

export default async function CatalogPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim().slice(0, 300);
  const [courses, hits] = await Promise.all([listCourses(), q ? searchCourses(q, { limit: 8 }) : Promise.resolve([] as CourseHit[])]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const models = [...new Set(courses.map((c) => c.embeddingModel).filter(Boolean))];
  const areas = new Set(courses.map((c) => c.hrdFocusArea)).size;
  const matchedBy = hits[0]?.matchedBy;

  return (
    <Frame crumbs={[{ label: "Knowledge" }, { label: "Course catalog" }]}>
      <PageHeader
        title="Course catalog"
        summary={`${courses.length} courses across ${areas} HRD focus areas · semantic search over syllabus vectors (${models.join(", ") || "not embedded yet"}) · NOSS codes are illustrative placeholders`}
      >
        <form action="/knowledge/catalog" className="flex max-w-[720px] items-center gap-2" role="search">
          <TextInput name="q" defaultValue={q} aria-label="Describe the training need" placeholder="Describe the training need — e.g. forklift safety for warehouse staff" />
          <SecondaryButton type="submit">Search</SecondaryButton>
          {q ? (
            <Link href="/knowledge/catalog" className={LINK_BUTTON.ghost}>
              Clear
            </Link>
          ) : null}
        </form>
      </PageHeader>
      <Body>
        {q ? (
          <>
            <p className="-mt-1 text-[12px] text-ink-muted">
              {hits.length} match{hits.length === 1 ? "" : "es"} for “{q}” ·{" "}
              {matchedBy === "LEXICAL"
                ? "full-text fallback (the embedding model was unreachable), ranked by ts_rank — not a similarity"
                : `cosine similarity against ${models.join(", ")} vectors, 1.00 is identical${models.includes(LOCAL_EMBEDDING_MODEL) ? " — the local hashing model (no embedding key) scores low in absolute terms, so read the order" : ""}`}
            </p>
            <DataTable
              label={`Search results for ${q}`}
              rows={hits}
              rowKey={(h) => h.id}
              rowHref={(h) => `/knowledge/catalog/${h.id}`}
              density="compact"
              empty={<p className="px-3 py-8 text-center text-[13px] text-ink-muted">No course matches. Try the words a client would use.</p>}
              columns={[
                { key: "rank", label: "#", width: "40px", cell: (h) => <span className="font-mono text-[12px] text-ink-muted">{hits.indexOf(h) + 1}</span> },
                {
                  key: "score",
                  label: matchedBy === "LEXICAL" ? "Text rank" : "Similarity",
                  width: "150px",
                  cell: (h) => (
                    <span className="flex items-center gap-2">
                      {h.matchedBy === "VECTOR" ? <MiniBar value={h.score} state="primary" width="56px" label={`Similarity ${h.score.toFixed(2)}`} /> : null}
                      <span className="font-mono text-[12px] tabular-nums">{h.score.toFixed(h.matchedBy === "VECTOR" ? 2 : 3)}</span>
                    </span>
                  ),
                },
                { key: "code", label: "Code", mono: true, cell: (h) => <span className="whitespace-nowrap">{h.courseCode}</span> },
                { key: "title", label: "Course", cell: (h) => <span className="font-medium text-ink">{h.title}</span> },
                { key: "area", label: "HRD focus area", cell: (h) => h.hrdFocusArea },
                { key: "sen", label: "Audience", cell: (h) => <span className="whitespace-nowrap">{`${SENIORITY_LABEL[h.targetSeniority] ?? h.targetSeniority} · L${h.level}`}</span> },
                { key: "days", label: "Days", align: "right", cell: (h) => String(h.durationDays) },
                { key: "out", label: "Outcomes", align: "right", cell: (h) => String(byId.get(h.id)?.outcomeCount ?? "—") },
              ]}
            />
          </>
        ) : (
          <DataTable
            label="Course catalog"
            rows={courses}
            rowKey={(c) => c.id}
            rowHref={(c) => `/knowledge/catalog/${c.id}`}
            density="compact"
            empty={<p className="px-3 py-8 text-center text-[13px] text-ink-muted">The catalog is empty. The seed loads the illustrative course set.</p>}
            columns={[
              { key: "code", label: "Code", mono: true, cell: (c) => <span className="whitespace-nowrap">{c.courseCode}</span> },
              { key: "title", label: "Course", cell: (c) => <span className="font-medium text-ink">{c.title}</span> },
              { key: "area", label: "HRD focus area", cell: (c) => c.hrdFocusArea },
              { key: "sen", label: "Audience", cell: (c) => <span className="whitespace-nowrap">{`${SENIORITY_LABEL[c.targetSeniority] ?? c.targetSeniority} · L${c.level}`}</span> },
              { key: "days", label: "Days", align: "right", cell: (c) => String(c.durationDays) },
              { key: "out", label: "Outcomes", align: "right", cell: (c) => String(c.outcomeCount) },
              { key: "next", label: "Next course", mono: true, cell: (c) => c.nextCourseCode ?? "—" },
              { key: "pk", label: "Packages", align: "right", cell: (c) => String(c.packages) },
              { key: "vec", label: "Search index", cell: (c) => (c.embedded ? <span className="text-[12px] text-ink-muted">vector</span> : <StatusChip tone="warning">not embedded</StatusChip>) },
            ]}
          />
        )}
        <p className="text-[12px] text-ink-muted">Outcomes are written against Bloom&apos;s revised taxonomy ({Object.values(BLOOM_LEVELS).join(" → ")}); every outcome must open with an approved verb at the level it claims.</p>
      </Body>
    </Frame>
  );
}
