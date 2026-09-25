import type { Light, TrafficLight } from "@/components/kit/TrafficLights";
import { daysBetween } from "@/lib/dates";

/**
 * The tri-factor readiness lights (Trainer · Venue · e-TRiS grant), derived
 * from facts, never stored. One function feeds the Kanban card, the record
 * header and the T-14 desk, so the three can never disagree.
 */
export interface ReadinessFacts {
  operationalStage: string;
  deliveryMode: string;
  venueByClient: boolean;
  startDate: string | null;
  etrisGrantId: string | null;
  grantApprovedAmount: string | null;
  trainerStatus: string | null;
  trainerTttVerified: boolean | null;
  trainerHoldExpiry: string | null;
  trainerName: string | null;
  venueStatus: string | null;
  venuePostponementDeadline: string | null;
  venueName: string | null;
}

const EARLY = new Set(["DRAFT", "QUOTED"]);
const CLOSED = new Set(["CANCELLED", "DELIVERY_COMPLETED"]);

export function readinessLights(f: ReadinessFacts, today: string): TrafficLight[] {
  const closed = CLOSED.has(f.operationalStage);
  const early = EARLY.has(f.operationalStage);
  const soon = f.startDate ? daysBetween(today, f.startDate) <= 21 : false;

  let trainer: Light;
  let trainerDetail: string;
  if (closed) {
    trainer = f.operationalStage === "DELIVERY_COMPLETED" ? "green" : "off";
    trainerDetail = f.trainerName ?? "—";
  } else if (!f.trainerStatus) {
    trainer = early ? "off" : "red";
    trainerDetail = "no trainer held";
  } else if (f.trainerStatus === "CONFIRMED" && f.trainerTttVerified) {
    trainer = "green";
    trainerDetail = `${f.trainerName} confirmed, TTT verified`;
  } else if (f.trainerStatus === "CONFIRMED") {
    trainer = "red";
    trainerDetail = `${f.trainerName} confirmed but TTT unverified`;
  } else if (f.trainerHoldExpiry && f.trainerHoldExpiry < today) {
    trainer = "red";
    trainerDetail = `${f.trainerName} hold expired ${f.trainerHoldExpiry}`;
  } else {
    trainer = "amber";
    trainerDetail = `${f.trainerName} tentative hold`;
  }

  let venue: Light;
  let venueDetail: string;
  if (f.deliveryMode === "ROT_VIRTUAL") {
    venue = closed ? "off" : "green";
    venueDetail = "remote online — no venue";
  } else if (f.venueByClient) {
    venue = closed ? "off" : "green";
    venueDetail = "client premises";
  } else if (closed) {
    venue = f.operationalStage === "DELIVERY_COMPLETED" ? "green" : "off";
    venueDetail = f.venueName ?? "—";
  } else if (!f.venueStatus || f.venueStatus === "CANCELLED") {
    venue = early ? "off" : "red";
    venueDetail = "no venue held";
  } else if (f.venueStatus === "BEO_SIGNED" || f.venueStatus === "DO_RECEIVED") {
    venue = "green";
    venueDetail = `${f.venueName} BEO signed`;
  } else if (f.venuePostponementDeadline && f.venuePostponementDeadline < today) {
    venue = "red";
    venueDetail = `${f.venueName} provisional past its free window`;
  } else {
    venue = "amber";
    venueDetail = `${f.venueName} provisional`;
  }

  let grant: Light;
  let grantDetail: string;
  if (f.etrisGrantId && f.grantApprovedAmount) {
    grant = "green";
    grantDetail = `approved ${f.etrisGrantId}`;
  } else if (f.operationalStage === "GRANT_PENDING") {
    grant = soon ? "red" : "amber";
    grantDetail = soon ? "pending and delivery is inside 21 days" : "application with client HR";
  } else if (early || closed) {
    grant = "off";
    grantDetail = early ? "not yet filed" : "—";
  } else {
    grant = "red";
    grantDetail = "no approved grant on record";
  }

  return [
    { key: "trainer", label: "Trainer", light: trainer, detail: trainerDetail },
    { key: "venue", label: "Venue", light: venue, detail: venueDetail },
    { key: "grant", label: "e-TRiS", light: grant, detail: grantDetail },
  ];
}
