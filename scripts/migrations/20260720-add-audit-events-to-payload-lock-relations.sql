BEGIN;

LOCK TABLE "public"."payload_locked_documents_rels"
IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "public"."payload_locked_documents_rels"
  ADD COLUMN IF NOT EXISTS "audit_events_id" integer;

CREATE INDEX IF NOT EXISTS
  "payload_locked_documents_rels_audit_events_id_idx"
ON "public"."payload_locked_documents_rels" ("audit_events_id");

COMMENT ON COLUMN
  "public"."payload_locked_documents_rels"."audit_events_id"
IS 'Payload document-lock relationship target for audit-events.';

COMMIT;