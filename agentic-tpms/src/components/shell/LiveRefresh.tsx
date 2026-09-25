"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Subscribes to /api/v1/events and refreshes the server components when a
 * domain event lands (optionally only for one entity). Debounced so a burst of
 * coupled transitions causes one refresh, not five.
 */
export function LiveRefresh({ entityId }: { entityId?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/v1/events");
    source.addEventListener("domain", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { entityId?: string };
        if (entityId && data.entityId !== entityId) return;
      } catch {
        return;
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    });
    return () => {
      clearTimeout(timer.current);
      source.close();
    };
  }, [entityId, router]);
  return null;
}
