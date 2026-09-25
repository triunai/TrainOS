import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { THEME_BOOTSTRAP } from "@/components/shell/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Agentic TPMS", template: "%s · Agentic TPMS" },
  description: "Training provider operating system for HRD Corp SBL-Khas — enquiry to grant to delivery to claim.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23181A1F'/%3E%3Crect x='8' y='9' width='16' height='3' rx='1.5' fill='%231F5BFF'/%3E%3Crect x='8' y='15' width='11' height='3' rx='1.5' fill='%23FAFBFC'/%3E%3Crect x='8' y='21' width='7' height='3' rx='1.5' fill='%2369717C'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        <Toaster position="bottom-right" richColors={false} closeButton />
      </body>
    </html>
  );
}
