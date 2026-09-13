import type { Me } from "@trainos/contract";

/**
 * The fields the profile modal draws that `Me` does not carry.
 *
 * CONTRACT GAP, recorded here rather than papered over. The contract's `Me`
 * (§2, `packages/contract/src/domain/shell.ts`) is id, name, role, permissions,
 * dataScope, locale, timezone and theme. Kit.dc.html §07 "Profile modal · 960"
 * draws eleven more: the tenant's name and code, the holder's location, the
 * last sign-in, the current session's browser and place, job title, department,
 * email, mobile, staff number, and the module / 2FA / session counts.
 *
 * None of them are invented into `packages/contract` — a UI that needs a field
 * is not a reason to publish one. They live HERE, in the app, in one file, so
 * that every value the modal shows which did not come from the API is visible
 * in a single place. When `/v1/me` grows them, this file is what is deleted.
 *
 * Also listed as gap 14 in `packages/fixtures/README.md`.
 */

export interface ProfileDetails {
  orgName: string;
  orgCode: string;
  location: string;
  lastSignIn: string;
  session: string;
  jobTitle: string;
  department: string;
  email: string;
  mobile: string;
  staffNumber: string;
  moduleCount: number;
  twoFactor: boolean;
  activeSessions: number;
}

/**
 * Amirah Yusof, the pack's primary sales user (§6.2), with the artboard's own
 * values. INVENTED — every field here is drawn in Kit.dc.html and returned by
 * nothing.
 */
export const FIXTURE_PROFILE_DETAILS: ProfileDetails = {
  orgName: "Akademi Perdana",
  orgCode: "APSB",
  location: "Klang Valley",
  lastSignIn: "11-09-2026 08:04:22 AM",
  session: "Chrome · Shah Alam, GMT+8",
  jobTitle: "Senior Sales Consultant",
  department: "Commercial",
  email: "amirah.yusof@akademiperdana.my",
  mobile: "+60 12-448 9021",
  staffNumber: "APSB-0142",
  moduleCount: 7,
  twoFactor: true,
  activeSessions: 2,
};

/**
 * Which of these a real `/v1/me` would have to return, for whoever writes that
 * endpoint. Exported so a test can assert the list has not silently grown.
 */
export const PROFILE_FIELDS_NOT_IN_CONTRACT: readonly (keyof ProfileDetails)[] = [
  "orgName",
  "orgCode",
  "location",
  "lastSignIn",
  "session",
  "jobTitle",
  "department",
  "email",
  "mobile",
  "staffNumber",
  "moduleCount",
  "twoFactor",
  "activeSessions",
];

/** "Akademi Perdana · Klang Valley". */
export const orgAndLocation = (details: ProfileDetails): string =>
  `${details.orgName} · ${details.location}`;

/** The modal's chip row, in the artboard's order. */
export const profileChips = (details: ProfileDetails) =>
  [
    { label: `${details.moduleCount} modules`, tone: "accent" as const },
    details.twoFactor
      ? { label: "2FA on", tone: "success" as const }
      : { label: "2FA off", tone: "neutral" as const },
    { label: `${details.activeSessions} active sessions`, tone: "neutral" as const },
  ] satisfies { label: string; tone: "accent" | "success" | "neutral" }[];

/** The pack's wording for the two scope selects, from `Me.dataScope`. */
export const SCOPE_LABEL: Readonly<Record<string, string>> = {
  ALL: "All clients",
  MY_ACCOUNTS: "My accounts",
  MY_TEAM: "My team",
  OWN: "Own records",
};

export const scopeLabels = (me: Me) => ({
  clients: SCOPE_LABEL[me.dataScope.clients] ?? me.dataScope.clients,
  teams: SCOPE_LABEL[me.dataScope.teams] ?? me.dataScope.teams,
});
