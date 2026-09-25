"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** A table row that navigates. The only client piece of DataTable, so cells can render on the server. */
export function ClickableRow({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
        router.push(href);
      }}
      className={className}
    >
      {children}
    </tr>
  );
}
