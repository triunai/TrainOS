/**
 * Public surface of the messaging adapters. Every lane that sends an email or
 * a WhatsApp message imports from here; each send writes one
 * tpms.outbound_messages row (SENT / LOGGED / FAILED).
 */
export { sendMail, type MailAttachment, type SendMailInput, type SendMailResult } from "./mail";
export { sendWhatsAppText, type SendWhatsAppInput, type SendWhatsAppResult } from "./whatsapp";
export { listOutboundMessages, type MessageChannel, type MessageStatus } from "./log";
export { setGraphFetchForTests, GraphError } from "./graph";
export {
  outboundMessages,
  outboundSuppressions,
  type OutboundMessage,
  type OutboundSuppression,
  type AttachmentRecord,
} from "./schema";
