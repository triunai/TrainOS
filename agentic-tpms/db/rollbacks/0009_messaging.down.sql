-- Rollback for 0009_messaging.sql
set local search_path = tpms, extensions, public;

drop table if exists outbound_suppressions;
drop trigger if exists trg_outbound_messages_append_only on outbound_messages;
drop table if exists outbound_messages;
drop function if exists outbound_messages_refuse_mutation();
