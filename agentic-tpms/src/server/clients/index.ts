/**
 * Public surface of the client read models. Client creation lives with
 * intake (`createClient` in @/server/ingestion), which owns the dedupe rules.
 */
export { listClients, search, type ClientRow, type SearchHit } from "./queries";
