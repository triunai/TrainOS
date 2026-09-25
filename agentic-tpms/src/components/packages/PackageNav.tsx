"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { Breadcrumb, PillTabNav } from "@/components/kit";

/** Section vocabulary for a package record — one list feeds the tabs and the breadcrumb. */
export const PACKAGE_SECTIONS = [
  { id: "overview", segment: null, label: "Overview" },
  { id: "commercials", segment: "commercials", label: "Commercials" },
  { id: "grant", segment: "grant", label: "Grant" },
  { id: "logistics", segment: "logistics", label: "Logistics" },
  { id: "participants", segment: "participants", label: "Participants" },
  { id: "attendance", segment: "attendance", label: "Attendance" },
  { id: "claims", segment: "claims", label: "Claims & AP" },
  { id: "audit", segment: "audit", label: "Audit" },
] as const;

function current(segment: string | null) {
  return PACKAGE_SECTIONS.find((s) => s.segment === segment) ?? PACKAGE_SECTIONS[0];
}

/** `Home › Operations › PKG-2026-0012 › Commercials` — the path, never the identity. */
export function PackageBreadcrumb({ code }: { code: string }) {
  const section = current(useSelectedLayoutSegment());
  return (
    <Breadcrumb
      items={[
        { label: "Home", href: "/" },
        { label: "Operations", href: "/operations" },
        { label: code, href: `/operations/${code}` },
        { label: section.label },
      ]}
    />
  );
}

export function PackageTabs({ code, counts }: { code: string; counts: Partial<Record<string, number>> }) {
  const section = current(useSelectedLayoutSegment());
  return (
    <PillTabNav
      activeId={section.id}
      tabs={PACKAGE_SECTIONS.map((s) => ({
        id: s.id,
        label: s.label,
        count: counts[s.id],
        href: s.segment ? `/operations/${code}/${s.segment}` : `/operations/${code}`,
      }))}
    />
  );
}
