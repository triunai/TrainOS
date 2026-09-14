-- Removes what supabase/seeds/hosted_demo_finance.sql added to tenant
-- `akademi-perdana` — EXCEPT the two things the product itself never lets
-- anyone remove, voided instead, as documented below.
--
-- Run:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_finance_wipe.sql
--
-- NOT UNDONE, BY DESIGN — this is not a gap, it is the domain working as built,
-- verified by running it (the first two drafts of this file each hit a refusal
-- that said so directly):
--
--   * `core.payments` is append-only (010 §7, `core.payment_reject_mutation`):
--     the trigger fires on every DELETE regardless of role — `REVOKE … FROM
--     … authenticated` only withholds EXECUTE on calling the function as an
--     RPC, a trigger fires unconditionally — so `pay:aurora:1` cannot be
--     deleted by this file or by anyone else. The product's own answer to "I
--     recorded this in error" is a reversal row, never a delete, and this is
--     a demo receipt, not a real one, so it is simply left.
--   * The invoice a payment landed on has no way back either. 011's registry
--     gates `VOID` only from `DRAFT`/`SENT`/`OVERDUE` (011:1116-1118) — there
--     is no `PARTIALLY_PAID -> VOID` edge, so Aurora's invoice (INV, partially
--     paid below) cannot be voided any more than its payment can be deleted.
--     `core.invoices` also carries `ON DELETE RESTRICT` from `core.payments`
--     and `core.engagements` carries the same from `core.invoices` (008/010),
--     so as long as the payment stands, neither the Aurora invoice nor either
--     engagement can be deleted either. Left exactly as recorded.
--
-- Meridian's invoice never received a payment, so `OVERDUE -> VOID` (011:1118,
-- ungated) is exactly the product's legal "I want this gone" for it, and this
-- file takes it, with a `void_reason` naming it as demo cleanup.
--
-- Fully removed: the Meridian collections case, its drafted reminder message,
-- and the one message rate this seed added (nothing restricts deleting any of
-- those), plus the `core.action_requests` rows this seed opened, which are
-- pure audit trail with no other row pointing back at them.

DROP TABLE IF EXISTS pg_temp.demo_id;
CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:' || p_key) AS h) AS k;
$fn$;

DROP TABLE IF EXISTS pg_temp.demo_wipe_ctx;
CREATE TEMP TABLE demo_wipe_ctx ON COMMIT DROP AS
SELECT tenant.id AS t FROM public.tenants AS tenant WHERE tenant.slug = 'akademi-perdana';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM demo_wipe_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted finance wipe: tenant akademi-perdana not found';
  END IF;
END
$guard$;

DELETE FROM core.outbound_messages
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id = pg_temp.demo_id('msg:col:meridian');
DELETE FROM core.message_rates
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id = pg_temp.demo_id('rate:whatsapp:utility');
DELETE FROM core.collections_cases
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id = pg_temp.demo_id('col:meridian');
DELETE FROM core.action_requests
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx)
   AND target_id IN (pg_temp.demo_id('quo:aurora'), pg_temp.demo_id('quo:meridian'),
                     pg_temp.demo_id('inv:aurora'), pg_temp.demo_id('inv:meridian'),
                     pg_temp.demo_id('col:meridian'));

-- Meridian carries no payment, so it is fully void-able and left with no live
-- collections case pointing at it (deleted above).
UPDATE core.invoices SET status = 'VOID', voided_at = now(), void_reason = 'hosted demo finance wipe: demo invoice'
 WHERE tenant_id = (SELECT t FROM demo_wipe_ctx) AND id = pg_temp.demo_id('inv:meridian')
   AND status <> 'VOID';

-- Aurora is left exactly as recorded (see the header): a payment has landed on
-- it, and neither the payment nor a `PARTIALLY_PAID` invoice can be undone.

DO $verify$
DECLARE v_t uuid;
BEGIN
  SELECT t INTO v_t FROM demo_wipe_ctx;
  IF EXISTS (SELECT 1 FROM core.collections_cases WHERE tenant_id = v_t AND id = pg_temp.demo_id('col:meridian'))
     OR EXISTS (SELECT 1 FROM core.outbound_messages WHERE tenant_id = v_t AND id = pg_temp.demo_id('msg:col:meridian'))
     OR EXISTS (SELECT 1 FROM core.message_rates WHERE tenant_id = v_t AND id = pg_temp.demo_id('rate:whatsapp:utility')) THEN
    RAISE EXCEPTION 'hosted finance wipe: a removable row survived';
  END IF;
  IF (SELECT status FROM core.invoices WHERE tenant_id = v_t AND id = pg_temp.demo_id('inv:meridian')) <> 'VOID' THEN
    RAISE EXCEPTION 'hosted finance wipe: the Meridian invoice was not voided';
  END IF;
  IF (SELECT status FROM core.invoices WHERE tenant_id = v_t AND id = pg_temp.demo_id('inv:aurora')) <> 'PARTIALLY_PAID' THEN
    RAISE EXCEPTION 'hosted finance wipe: the Aurora invoice changed status unexpectedly';
  END IF;
END
$verify$;
