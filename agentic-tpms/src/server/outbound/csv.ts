import { DomainError } from "@/server/domain/errors";
import type { OutboundTarget } from "./harvey";

/**
 * Imports a permissioned B2B target list (company, name, email, ssm, notes).
 *
 * This is the only way targets enter the outbound pipeline besides our own
 * webhooks: the provider uploads a list it has the right to use. Nothing here
 * fetches, scrapes or enriches from third-party registries or private
 * channels — that is out of scope by the PRD, not a missing feature.
 */
export interface CsvImportResult {
  targets: OutboundTarget[];
  errors: Array<{ line: number; message: string }>;
}

const HEADERS: Record<keyof OutboundTarget, string[]> = {
  company: ["company", "company_name", "companyname", "organisation", "organization", "syarikat"],
  picName: ["name", "pic", "pic_name", "contact", "contact_name", "full_name", "fullname"],
  picEmail: ["email", "pic_email", "email_address", "work_email", "e-mail", "emel"],
  ssm: ["ssm", "ssm_number", "ssm_no", "registration", "registration_no", "company_no"],
  hiringSignal: ["notes", "note", "hiring_signal", "signal", "hiring", "remarks"],
};

/** RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new DomainError("CSV_UNTERMINATED_QUOTE", "The file ends inside a quoted field");
  if (field !== "" || row.length) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function importTargetsCsv(text: string): CsvImportResult {
  const table = parseCsv(text);
  if (table.length === 0) throw new DomainError("CSV_EMPTY", "The file has no rows");
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const column = (key: keyof OutboundTarget) => header.findIndex((h) => HEADERS[key].includes(h));
  const idx = {
    company: column("company"),
    picName: column("picName"),
    picEmail: column("picEmail"),
    ssm: column("ssm"),
    hiringSignal: column("hiringSignal"),
  };
  if (idx.company < 0 || idx.picEmail < 0) {
    throw new DomainError("CSV_MISSING_COLUMNS", "The header row needs at least a company column and an email column", { header });
  }

  const targets: OutboundTarget[] = [];
  const errors: CsvImportResult["errors"] = [];
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
  table.slice(1).forEach((row, n) => {
    const line = n + 2;
    const company = cell(row, idx.company);
    const email = cell(row, idx.picEmail).toLowerCase();
    if (!company) errors.push({ line, message: "missing company" });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ line, message: `invalid email: ${email || "(empty)"}` });
    else {
      targets.push({
        company,
        picEmail: email,
        picName: cell(row, idx.picName) || null,
        ssm: cell(row, idx.ssm) || null,
        hiringSignal: cell(row, idx.hiringSignal) || null,
      });
    }
  });
  return { targets, errors };
}
