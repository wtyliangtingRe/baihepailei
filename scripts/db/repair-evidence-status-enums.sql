-- Repair Payload/Postgres enum drift for Evidence status values.
--
-- Safe to run repeatedly on PostgreSQL versions that support
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS.
--
-- Local Docker usage from the repository root:
-- Get-Content scripts/db/repair-evidence-status-enums.sql |
--   docker exec -i baihepailei-postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"'

ALTER TYPE enum_evidence_status ADD VALUE IF NOT EXISTS 'review';
ALTER TYPE enum_evidence_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE enum_evidence_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TYPE enum__evidence_v_version_status ADD VALUE IF NOT EXISTS 'review';
ALTER TYPE enum__evidence_v_version_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE enum__evidence_v_version_status ADD VALUE IF NOT EXISTS 'archived';

select
  t.typname,
  e.enumlabel
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typname in ('enum_evidence_status', 'enum__evidence_v_version_status')
order by t.typname, e.enumsortorder;
