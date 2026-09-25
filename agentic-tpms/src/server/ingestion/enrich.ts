import { sql } from "drizzle-orm";
import { type Tx, one } from "@/server/db/client";
import type { Lead } from "@/server/db/schema";
import { graphRequest } from "@/server/messaging/graph";
import { intakeConfig } from "./config";
import { normaliseMetaLeadgen } from "./normalise";
import { intakeOf } from "./queries";
import type { NormalisedLead } from "./types";

/**
 * Meta Lead Ads notifications carry only ids; the answers live behind
 * `GET /{leadgen_id}`. The fetch runs in the triage task, never in the
 * webhook request, so a slow Graph API cannot push the ack past Meta's retry
 * deadline. Without META_PAGE_ACCESS_TOKEN the lead stays minimal and the
 * classifier abstains, which routes it to a human.
 */
interface GraphLead {
  id?: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  campaign_id?: string;
  field_data?: Array<{ name: string; values: string[] }>;
}

export async function fetchMetaLeadFields(lead: Lead): Promise<NormalisedLead | null> {
  const intake = intakeOf(lead);
  const token = intakeConfig.metaPageAccessToken();
  const leadgenId = intake.platformIds.leadgen_id;
  if (!intake.needsEnrichment || !token || !leadgenId) return null;
  const fetched = await graphRequest<GraphLead>(leadgenId, {
    token,
    query: { fields: "id,created_time,ad_id,form_id,campaign_id,field_data" },
  });
  return normaliseMetaLeadgen({ ...fetched, leadgen_id: leadgenId, page_id: intake.platformIds.page_id, adgroup_id: intake.platformIds.adgroup_id });
}

/** Writes the fetched fields onto the (locked) lead and clears the enrichment flag. */
export async function applyEnrichment(tx: Tx, lead: Lead, fields: NormalisedLead): Promise<void> {
  const intake = { ...intakeOf(lead), needsEnrichment: false, platformIds: { ...intakeOf(lead).platformIds, ...fields.platformIds } };
  await one(
    tx,
    sql`update tpms.lead_records
           set company_name = ${fields.companyName}, company_domain = ${fields.companyDomain},
               ssm_registration_number = ${fields.ssm}, pic_full_name = ${fields.picName}, pic_email = ${fields.picEmail},
               pic_phone_e164 = ${fields.picPhoneE164}, training_topic = ${fields.topic}, message = ${fields.message},
               campaign_id = coalesce(${fields.campaignId}, campaign_id), ad_id = coalesce(${fields.adId}, ad_id),
               has_whatsapp_opt_in = ${fields.whatsappOptIn}, estimated_pax = ${fields.estimatedPax},
               delivery_preference = ${fields.deliveryPreference},
               tna_profile = jsonb_set(tna_profile, '{intake}', ${JSON.stringify(intake)}::jsonb)
         where id = ${lead.id}::uuid
         returning id`,
  );
}
