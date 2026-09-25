import type { HandlerMap } from "../queue/registry";
import { packagePayload } from "../claims/tasks";
import { draftPaymentVouchers } from "./vouchers";

export const handlers: HandlerMap = {
  "finance.draft_payment_vouchers": async (task) => {
    const { packageId } = packagePayload(task.payload, "finance.draft_payment_vouchers");
    return { ...(await draftPaymentVouchers(packageId, { taskId: task.id })) };
  },
};
