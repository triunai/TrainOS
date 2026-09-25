import Link from "next/link";
import { Body, PageHeader, Section, StatusChip } from "@/components/kit";
import { Frame } from "@/components/shell/Frame";
import { search } from "@/server/clients/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim();
  const hits = q.length >= 2 ? await search(q) : [];
  return (
    <Frame crumbs={[{ label: "Search" }]}>
      <PageHeader title="Search" summary={q ? `${hits.length} result${hits.length === 1 ? "" : "s"} for “${q}”` : "Type at least two characters in the search box"} />
      <Body>
        <Section flush>
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-muted">No matches.</p>
          ) : (
            <ul>
              {hits.map((h) => (
                <li key={`${h.kind}-${h.id}`} className="flex items-center gap-3 border-b border-divider px-4 py-2.5 last:border-b-0">
                  <StatusChip shape="square" className="w-[70px] justify-center text-[11px]">{h.kind.toLowerCase()}</StatusChip>
                  <Link href={h.href} className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink hover:underline">{h.title}</span>
                    <span className="block truncate text-[12px] text-ink-muted">{h.subtitle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Body>
    </Frame>
  );
}
